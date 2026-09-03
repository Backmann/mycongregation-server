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
  minutesOfDayIn,
  todayIn,
} from '../common/congregation-clock';
import {
  coerceLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { collectedReportMonth, monthKey } from '../common/report-month-window';

/**
 * Six in the evening, BY THE CONGREGATION'S CLOCK.
 *
 * This used to be a @Cron firing at 18:00 Berlin for everybody, because a
 * decorator is read once when the class is built and cannot ask each
 * congregation what time it is there. A congregation a few hours away would
 * have been nudged in the afternoon, or in the middle of the night.
 *
 * So the job now ticks every hour and asks. A tick does nothing at all until
 * the congregation's own clock has reached this hour on one of its days —
 * and the dedupe key carries the congregation's own DATE, so a reminder is
 * sent once however many ticks pass afterwards. That also makes the tick
 * forgiving of a restart: the evening is not missed because the server was
 * down at exactly six.
 *
 * "At or after", not "at": half-hour timezones exist (India is +05:30), and
 * an hourly tick would never land on the hour there.
 */
const REMINDER_HOUR = 18;

/**
 * Three evenings, not ten.
 *
 * A reminder every evening from the 1st to the 10th is not persistence, it is
 * nagging — and the thing people do about nagging is switch notifications off
 * entirely, which then costs them the assignment they did want to hear about.
 * So the person is asked three times and then it stops being pressed on him:
 * the matter moves up to the group's overseer, and after that to the
 * secretary. Responsibility escalates; the volume does not.
 *
 * The 1st is deliberate and different: not a reproach but an opening — the
 * month has ended and the report can now be handed in.
 *
 * The third evening was the 9th while a publisher could only correct his own
 * report through the 10th — the last call came just before his own door shut.
 * That door now closes with the month itself, on the 20th, so the last call
 * moved to the 15th: still his own to answer, five days of room left, and
 * after the overseer has already been asked. Three evenings either way.
 *
 * These are the days the code actually uses. The class comment above them used
 * to describe a different schedule entirely, which is how a reader learns to
 * stop trusting comments.
 */
const PUBLISHER_DAYS = [1, 5, 15];
const OVERSEER_DAYS = [7, 12];
const SECRETARY_DAYS = [13, 18];

/** Locale used to name a month, per supported language. */
const MONTH_LOCALE: Record<SupportedLanguage, string> = {
  ru: 'ru-RU',
  en: 'en-GB',
  de: 'de-DE',
};

/**
 * What the reminders say.
 *
 * These were three Russian literals in the code, while the app has spoken
 * three languages for months and there is a per-service STR table for exactly
 * this. A German congregation would have been nudged in Russian.
 */
const STR: Record<
  SupportedLanguage,
  {
    publisherTitle: string;
    publisherOpening: (month: string) => string;
    publisherReminder: (month: string) => string;
    overseerTitle: string;
    overseerBody: (group: string, month: string, names: string) => string;
    secretaryTitle: string;
    secretaryBody: (month: string, count: number, lines: string) => string;
    ungrouped: string;
  }
> = {
  ru: {
    publisherTitle: 'Отчёт о служении',
    publisherOpening: (m) => `${m} закончился — отчёт можно сдать.`,
    publisherReminder: (m) => `Вы ещё не подали отчёт за ${m}.`,
    overseerTitle: 'Несданные отчёты в группе',
    overseerBody: (g, m, names) => `Группа «${g}», ${m}: не сдали — ${names}.`,
    secretaryTitle: 'Несданные отчёты по общине',
    secretaryBody: (m, count, lines) =>
      `За ${m} не сдали (${count}):\n${lines}`,
    ungrouped: 'Без группы',
  },
  en: {
    publisherTitle: 'Field service report',
    publisherOpening: (m) => `${m} has ended — your report can be handed in.`,
    publisherReminder: (m) => `You have not handed in your report for ${m}.`,
    overseerTitle: 'Reports missing in your group',
    overseerBody: (g, m, names) =>
      `Group \u00ab${g}\u00bb, ${m}: not handed in — ${names}.`,
    secretaryTitle: 'Reports missing in the congregation',
    secretaryBody: (m, count, lines) =>
      `Not handed in for ${m} (${count}):\n${lines}`,
    ungrouped: 'No group',
  },
  de: {
    publisherTitle: 'Predigtdienstbericht',
    publisherOpening: (m) =>
      `${m} ist zu Ende — der Bericht kann abgegeben werden.`,
    publisherReminder: (m) =>
      `Du hast den Bericht für ${m} noch nicht abgegeben.`,
    overseerTitle: 'Fehlende Berichte in deiner Gruppe',
    overseerBody: (g, m, names) =>
      `Gruppe \u00ab${g}\u00bb, ${m}: nicht abgegeben — ${names}.`,
    secretaryTitle: 'Fehlende Berichte in der Versammlung',
    secretaryBody: (m, count, lines) =>
      `Für ${m} nicht abgegeben (${count}):\n${lines}`,
    ungrouped: 'Ohne Gruppe',
  },
};

/** Everything one congregation needs for one evening of reminders. */
interface ReminderContext {
  tenantId: string;
  timezone: string;
  lang: SupportedLanguage;
  reportMonth: string;
  day: number;
}

interface MissingPublisher {
  id: string;
  displayName: string;
  userId: string | null;
  serviceGroupId: string | null;
}

/**
 * Monthly field-service report reminders.
 *
 * The month being chased is always the previous calendar month, and both the
 * month and the day are read from each congregation's own calendar. The days
 * and the hour are the constants above — deliberately not written out again
 * here, because the list that used to stand in this comment had drifted away
 * from the code and was quietly wrong.
 *
 * Pushes reach only recipients who have a login and a registered token or
 * web-subscription.
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

  private monthLabel(reportMonth: string, lang: SupportedLanguage): string {
    return new Date(`${reportMonth}T00:00:00Z`).toLocaleDateString(
      MONTH_LOCALE[lang],
      { month: 'long', year: 'numeric', timeZone: 'UTC' },
    );
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

  /**
   * The tick.
   *
   * Runs every hour and decides, per congregation, whether anything is due
   * THERE: the right day of its own month, and its own clock past six in the
   * evening. Nothing else happens on a tick — one small row per congregation.
   *
   * A congregation whose evening has already passed is reached again on the
   * next tick, and the next; the dedupe key carries its local DATE, so only
   * the first of them says anything. That is also what makes a restart
   * harmless: the evening is not missed because the server was down at
   * exactly six.
   */
  @Cron('0 * * * *', {
    name: 'report-reminders-tick',
    timeZone: 'UTC',
  })
  async tick(): Promise<void> {
    const now = new Date();
    const congregations = await this.congregationRepo.find({
      select: ['id', 'timezone', 'language'],
    });
    for (const c of congregations) {
      const timezone = c.timezone || DEFAULT_CONGREGATION_TIMEZONE;
      if (minutesOfDayIn(now, timezone) < REMINDER_HOUR * 60) continue;
      const ctx: ReminderContext = {
        tenantId: c.id,
        timezone,
        lang: coerceLanguage(c.language),
        reportMonth: monthKey(collectedReportMonth(now, timezone)),
        day: localDateParts(now, timezone).day,
      };
      try {
        if (PUBLISHER_DAYS.includes(ctx.day)) await this.remindPublishers(ctx);
        if (OVERSEER_DAYS.includes(ctx.day)) await this.remindOverseers(ctx);
        if (SECRETARY_DAYS.includes(ctx.day)) await this.remindSecretary(ctx);
      } catch (err: any) {
        this.logger.error(
          `reminder job failed for tenant=${c.id}`,
          err?.stack ?? err?.message ?? String(err),
        );
      }
    }
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  /** Today for the congregation — reminder keys are per day, not per month. */
  private today(timezone: string): string {
    return todayIn(new Date(), timezone);
  }

  /** One evening of reminders to the publishers of one congregation. */
  async remindPublishers(ctx: ReminderContext): Promise<void> {
    const { tenantId, timezone, lang, reportMonth } = ctx;
    const t = STR[lang];
    const missing = await this.collectMissing(tenantId, reportMonth);
    const label = this.monthLabel(reportMonth, lang);
    let reached = 0;
    for (const p of missing) {
      if (!p.userId) continue;
      // The 1st opens the month; the later evenings remind.
      const opening = ctx.day === 1;
      await this.notifications.notify({
        tenantId,
        userIds: [p.userId],
        title: t.publisherTitle,
        body: opening
          ? t.publisherOpening(this.capitalize(label))
          : t.publisherReminder(label),
        kind: 'report_reminder',
        key: `report:${reportMonth}:publisher:${this.today(timezone)}`,
        data: { type: 'report_reminder', scope: 'publisher', reportMonth },
      });
      reached += 1;
    }
    if (reached > 0) {
      this.logger.log(
        `[publishers] tenant=${tenantId} month=${reportMonth} ` +
          `missing=${missing.length} reached=${reached}`,
      );
    }
  }

  /** One evening of per-group summaries to the group overseers. */
  async remindOverseers(ctx: ReminderContext): Promise<void> {
    const { tenantId, timezone, lang, reportMonth } = ctx;
    const t = STR[lang];
    const missing = await this.collectMissing(tenantId, reportMonth);
    if (missing.length === 0) return;
    const label = this.monthLabel(reportMonth, lang);
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
    const userIdByPublisherId = new Map(overseers.map((o) => [o.id, o.userId]));
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
        title: t.overseerTitle,
        body: t.overseerBody(g.name, label, names.join(', ')),
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
  }

  /** One evening of the congregation-wide summary to the secretary. */
  async remindSecretary(ctx: ReminderContext): Promise<void> {
    const { tenantId, timezone, lang, reportMonth } = ctx;
    const t = STR[lang];
    const missing = await this.collectMissing(tenantId, reportMonth);
    if (missing.length === 0) return;
    const label = this.monthLabel(reportMonth, lang);
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
      lines.push(`${t.ungrouped}: ${ungrouped.join(', ')}`);
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
      title: t.secretaryTitle,
      body: t.secretaryBody(label, missing.length, lines.join('\n')),
      kind: 'report_reminder',
      key: `report:${reportMonth}:secretary:${this.today(timezone)}`,
      data: { type: 'report_reminder', scope: 'secretary', reportMonth },
    });
    this.logger.log(
      `[secretary] tenant=${tenantId} month=${reportMonth} ` +
        `missing=${missing.length} recipients=${recipientIds.length}`,
    );
  }
}
