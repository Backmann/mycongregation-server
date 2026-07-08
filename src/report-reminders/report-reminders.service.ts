import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { Congregation } from '../entities/congregation.entity';
import { User } from '../entities/user.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

const BERLIN_TZ = 'Europe/Berlin';

interface MissingPublisher {
  id: string;
  displayName: string;
  userId: string | null;
  serviceGroupId: string | null;
}

/**
 * Monthly field-service report reminders. The month being chased is always the
 * previous calendar month (Europe/Berlin). All jobs fire at 18:00 Berlin.
 *   - publishers : daily 1st-10th  -> each publisher who has not submitted
 *   - overseers  : 5th, 7th, 10th  -> per-group summary to the group overseer
 *   - secretary  : 10/15/18/19     -> congregation summary to the secretary
 * Pushes reach only recipients who have a login + a registered token/web-sub.
 */
@Injectable()
export class ReportRemindersService {
  private readonly logger = new Logger(ReportRemindersService.name);

  constructor(
    @InjectRepository(Publisher)
    private readonly publisherRepo: Repository<Publisher>,
    @InjectRepository(ServiceReport)
    private readonly reportRepo: Repository<ServiceReport>,
    @InjectRepository(ServiceGroup)
    private readonly groupRepo: Repository<ServiceGroup>,
    @InjectRepository(Responsibility)
    private readonly responsibilityRepo: Repository<Responsibility>,
    @InjectRepository(Congregation)
    private readonly congregationRepo: Repository<Congregation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly push: PushNotificationsService,
  ) {}

  /** Previous calendar month in Berlin as 'YYYY-MM-01'. */
  private previousReportMonth(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BERLIN_TZ,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    let y = Number(parts.find((p) => p.type === 'year')!.value);
    let m = Number(parts.find((p) => p.type === 'month')!.value) - 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, '0')}-01`;
  }

  private monthLabel(reportMonth: string): string {
    return new Date(`${reportMonth}T00:00:00Z`).toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  /** Reporting publishers with no report for the month. Students
   * (appointment=STUDENT) don't submit reports, so they never get a reminder. */
  private async collectMissing(
    tenantId: string,
    reportMonth: string,
  ): Promise<MissingPublisher[]> {
    const publishers = await this.publisherRepo.find({
      where: {
        congregationId: tenantId,
        isActive: true,
        appointment: Not(PublisherAppointment.STUDENT),
      },
    });
    if (publishers.length === 0) return [];
    const reports = await this.reportRepo.find({
      where: { congregationId: tenantId, reportMonth },
      select: ['publisherId'],
    });
    const submitted = new Set(reports.map((r) => r.publisherId));
    return publishers
      .filter((p) => !submitted.has(p.id))
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        userId: p.userId,
        serviceGroupId: p.serviceGroupId,
      }));
  }

  private async eachCongregation(
    fn: (tenantId: string, reportMonth: string) => Promise<void>,
  ): Promise<void> {
    const congregations = await this.congregationRepo.find({ select: ['id'] });
    const reportMonth = this.previousReportMonth();
    for (const c of congregations) {
      try {
        await fn(c.id, reportMonth);
      } catch (err: any) {
        this.logger.error(
          `reminder job failed for tenant=${c.id}`,
          err?.stack ?? err?.message ?? String(err),
        );
      }
    }
  }

  @Cron('0 18 1-10 * *', {
    name: 'report-reminder-publishers',
    timeZone: BERLIN_TZ,
  })
  async remindPublishers(): Promise<void> {
    await this.eachCongregation(async (tenantId, reportMonth) => {
      const missing = await this.collectMissing(tenantId, reportMonth);
      const label = this.monthLabel(reportMonth);
      let reached = 0;
      for (const p of missing) {
        if (!p.userId) continue;
        await this.push.sendToUsers(
          tenantId,
          [p.userId],
          'Отчёт о служении',
          `Вы ещё не подали отчёт за ${label}. Пожалуйста, заполните его в приложении.`,
          { type: 'report_reminder', scope: 'publisher', reportMonth },
        );
        reached += 1;
      }
      this.logger.log(
        `[publishers] tenant=${tenantId} month=${reportMonth} ` +
          `missing=${missing.length} reached=${reached}`,
      );
    });
  }

  @Cron('0 18 5,7,10 * *', {
    name: 'report-reminder-overseers',
    timeZone: BERLIN_TZ,
  })
  async remindOverseers(): Promise<void> {
    await this.eachCongregation(async (tenantId, reportMonth) => {
      const missing = await this.collectMissing(tenantId, reportMonth);
      if (missing.length === 0) return;
      const label = this.monthLabel(reportMonth);
      const groups = await this.groupRepo.find({
        where: { congregationId: tenantId, overseerPublisherId: Not(IsNull()) },
      });
      const overseerIds = groups
        .map((g) => g.overseerPublisherId)
        .filter((x): x is string => !!x);
      const overseers =
        overseerIds.length > 0
          ? await this.publisherRepo.find({ where: { id: In(overseerIds) } })
          : [];
      const userIdByPublisherId = new Map(
        overseers.map((o) => [o.id, o.userId]),
      );
      for (const g of groups) {
        const names = missing
          .filter((m) => m.serviceGroupId === g.id)
          .map((m) => m.displayName);
        if (names.length === 0) continue;
        const overseerUserId = g.overseerPublisherId
          ? userIdByPublisherId.get(g.overseerPublisherId)
          : null;
        if (!overseerUserId) continue;
        await this.push.sendToUsers(
          tenantId,
          [overseerUserId],
          'Несданные отчёты в группе',
          `Группа «${g.name}», ${label}: не сдали — ${names.join(', ')}.`,
          {
            type: 'report_reminder',
            scope: 'overseer',
            reportMonth,
            serviceGroupId: g.id,
          },
        );
      }
      this.logger.log(
        `[overseers] tenant=${tenantId} month=${reportMonth} groups=${groups.length}`,
      );
    });
  }

  @Cron('0 18 10,15,18,19 * *', {
    name: 'report-reminder-secretary',
    timeZone: BERLIN_TZ,
  })
  async remindSecretary(): Promise<void> {
    await this.eachCongregation(async (tenantId, reportMonth) => {
      const missing = await this.collectMissing(tenantId, reportMonth);
      if (missing.length === 0) return;
      const label = this.monthLabel(reportMonth);
      const groups = await this.groupRepo.find({
        where: { congregationId: tenantId },
      });
      const groupName = new Map(groups.map((g) => [g.id, g.name]));

      const byGroup = new Map<string, string[]>();
      const ungrouped: string[] = [];
      for (const m of missing) {
        if (m.serviceGroupId && groupName.has(m.serviceGroupId)) {
          const arr = byGroup.get(m.serviceGroupId) ?? [];
          arr.push(m.displayName);
          byGroup.set(m.serviceGroupId, arr);
        } else {
          ungrouped.push(m.displayName);
        }
      }
      const lines: string[] = [];
      for (const [gid, names] of byGroup) {
        lines.push(`${groupName.get(gid)}: ${names.join(', ')}`);
      }
      if (ungrouped.length > 0) {
        lines.push(`Без группы: ${ungrouped.join(', ')}`);
      }

      const secretaries = await this.responsibilityRepo.find({
        where: { congregationId: tenantId, type: ResponsibilityType.SECRETARY },
      });
      let recipientIds = secretaries
        .map((r) => r.userId)
        .filter((x): x is string => !!x);
      if (recipientIds.length === 0) {
        const admins = await this.userRepo.find({
          where: { congregationId: tenantId, role: UserRole.ADMIN },
          select: ['id'],
        });
        recipientIds = admins.map((a) => a.id);
      }
      if (recipientIds.length === 0) return;

      await this.push.sendToUsers(
        tenantId,
        recipientIds,
        'Несданные отчёты по общине',
        `За ${label} не сдали (${missing.length}):\n${lines.join('\n')}`,
        { type: 'report_reminder', scope: 'secretary', reportMonth },
      );
      this.logger.log(
        `[secretary] tenant=${tenantId} month=${reportMonth} ` +
          `missing=${missing.length} recipients=${recipientIds.length}`,
      );
    });
  }
}
