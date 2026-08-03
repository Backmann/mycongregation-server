import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { reportingPublisherWhere } from '../common/reporting-publishers';
import { Congregation } from '../entities/congregation.entity';
import { User } from '../entities/user.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  localDateParts,
  todayIn,
} from '../common/congregation-clock';
import { collectedReportMonth, monthKey } from '../common/report-month-window';

/**
 * The hour the reminder jobs FIRE.
 *
 * A @Cron decorator is read once when the class is constructed, so this cannot
 * be per-congregation: every congregation is nudged at 18:00 Berlin. WHICH
 * month is chased and WHICH day it is are decided by each congregation's own
 * calendar (see eachCongregation) — only the clock that wakes the job is
 * shared. For a congregation a few hours away the evening nudge would arrive
 * in the afternoon or at night; fixing that means ticking hourly and asking
 * each congregation whether it is 18:00 there yet, which is a change worth
 * making deliberately rather than in passing.
 */
const JOB_FIRING_TZ = 'Europe/Berlin';

interface MissingPublisher {
  id: string;
  displayName: string;
  userId: string | null;
  serviceGroupId: string | null;
}

/**
 * Monthly field-service report reminders. The month being chased is always the
 * previous calendar month, in each congregation's own timezone. All jobs
 * fire at 18:00 Berlin — see JOB_FIRING_TZ.
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
    private readonly notifications: NotificationsService,
  ) {}

  /** Previous calendar month in the congregation's timezone, 'YYYY-MM-01'. */
  private previousReportMonth(timezone: string, now = new Date()): string {
    return monthKey(collectedReportMonth(now, timezone));
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
      where: reportingPublisherWhere(tenantId),
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
    fn: (
      tenantId: string,
      reportMonth: string,
      timezone: string,
    ) => Promise<void>,
  ): Promise<void> {
    // Read the timezone with the id: which month is being chased, and which
    // day it is, are answered by the congregation's own calendar. The firing
    // TIME is still Berlin — see the note on the class.
    const congregations = await this.congregationRepo.find({
      select: ['id', 'timezone'],
    });
    for (const c of congregations) {
      const timezone = c.timezone || DEFAULT_CONGREGATION_TIMEZONE;
      const reportMonth = this.previousReportMonth(timezone);
      try {
        await fn(c.id, reportMonth, timezone);
      } catch (err: any) {
        this.logger.error(
          `reminder job failed for tenant=${c.id}`,
          err?.stack ?? err?.message ?? String(err),
        );
      }
    }
  }

  /**
   * Day of the month for the congregation — the 1st speaks differently from
   * the rest.
   */
  private dayOfMonth(timezone: string): number {
    return localDateParts(new Date(), timezone).day;
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  /** Today for the congregation — reminder keys are per day, not per month. */
  private today(timezone: string): string {
    return todayIn(new Date(), timezone);
  }

  /**
   * Three evenings, not ten.
   *
   * A reminder every evening from the 1st to the 10th is not persistence, it
   * is nagging — and the thing people do about nagging is switch notifications
   * off entirely, which then costs them the assignment they did want to hear
   * about. So the person is asked three times and then it stops being pressed
   * on him: the matter moves up to the group's overseer, and after that to the
   * secretary. Responsibility escalates; the volume does not.
   *
   * The 1st is deliberate and different: it is not a reproach but an opening —
   * the month has ended and the report can now be handed in.
   */
  @Cron('0 18 1,5,9 * *', {
    name: 'report-reminder-publishers',
    timeZone: JOB_FIRING_TZ,
  })
  async remindPublishers(): Promise<void> {
    await this.eachCongregation(async (tenantId, reportMonth, timezone) => {
      const missing = await this.collectMissing(tenantId, reportMonth);
      const label = this.monthLabel(reportMonth);
      let reached = 0;
      for (const p of missing) {
        if (!p.userId) continue;
        // One reminder per person per day: the job may tick twice after a
        // restart, and being told twice in an evening is how people learn to
        // switch notifications off.
        const opening = this.dayOfMonth(timezone) === 1;
        await this.notifications.notify({
          tenantId,
          userIds: [p.userId],
          title: 'Отчёт о служении',
          body: opening
            ? `${this.capitalize(label)} закончился — отчёт можно сдать.`
            : `Вы ещё не подали отчёт за ${label}.`,
          kind: 'report_reminder',
          key: `report:${reportMonth}:publisher:${this.today(timezone)}`,
          data: { type: 'report_reminder', scope: 'publisher', reportMonth },
        });
        reached += 1;
      }
      this.logger.log(
        `[publishers] tenant=${tenantId} month=${reportMonth} ` +
          `missing=${missing.length} reached=${reached}`,
      );
    });
  }

  @Cron('0 18 7,12 * *', {
    name: 'report-reminder-overseers',
    timeZone: JOB_FIRING_TZ,
  })
  async remindOverseers(): Promise<void> {
    await this.eachCongregation(async (tenantId, reportMonth, timezone) => {
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
        await this.notifications.notify({
          tenantId,
          userIds: [overseerUserId],
          title: 'Несданные отчёты в группе',
          body: `Группа «${g.name}», ${label}: не сдали — ${names.join(', ')}.`,
          kind: 'report_reminder',
          key: `report:${reportMonth}:overseer:${g.id}:${this.today(timezone)}`,
          data: {
            type: 'report_reminder',
            scope: 'overseer',
            reportMonth,
            serviceGroupId: g.id,
          },
        });
      }
      this.logger.log(
        `[overseers] tenant=${tenantId} month=${reportMonth} groups=${groups.length}`,
      );
    });
  }

  @Cron('0 18 13,18 * *', {
    name: 'report-reminder-secretary',
    timeZone: JOB_FIRING_TZ,
  })
  async remindSecretary(): Promise<void> {
    await this.eachCongregation(async (tenantId, reportMonth, timezone) => {
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

      await this.notifications.notify({
        tenantId,
        userIds: recipientIds,
        title: 'Несданные отчёты по общине',
        body: `За ${label} не сдали (${missing.length}):\n${lines.join('\n')}`,
        kind: 'report_reminder',
        key: `report:${reportMonth}:secretary:${this.today(timezone)}`,
        data: { type: 'report_reminder', scope: 'secretary', reportMonth },
      });
      this.logger.log(
        `[secretary] tenant=${tenantId} month=${reportMonth} ` +
          `missing=${missing.length} recipients=${recipientIds.length}`,
      );
    });
  }
}
