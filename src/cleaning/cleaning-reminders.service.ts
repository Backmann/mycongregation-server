import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Publisher } from '../entities/publisher.entity';
import { ReminderLog } from '../entities/reminder-log.entity';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  coerceLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { DEFAULT_CONGREGATION_TIMEZONE } from '../common/congregation-clock';
import { MeetingAttendanceService } from '../meeting-attendance/meeting-attendance.service';

const LEAD_MINUTES = 120; // push 2 hours before a meeting / planned time
const TICK_MINUTES = 15; // must match the cron cadence
const MONDAY_HOUR = 9; // weekly-group Monday reminder, local time
const QUIET_START = 22; // no pushes 22:00–08:00 local
const QUIET_END = 8;

/** Wall-clock fields for a given instant in a given IANA timezone. */
interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoDow: number; // 1=Mon..7=Sun
  date: string; // YYYY-MM-DD
  minutesOfDay: number;
}

const STR: Record<
  SupportedLanguage,
  {
    afterTitle: string;
    afterBody: string;
    weeklyTitle: string;
    weeklyBody: (windows: string) => string;
    weeklyBodyNoWindows: string;
    plannedTitle: string;
    plannedBody: string;
    generalTitle: string;
    generalBody: string;
  }
> = {
  ru: {
    afterTitle: 'Уборка после встречи',
    afterBody:
      'Сегодня ваша группа убирает зал после встречи. Спасибо за ваш труд!',
    weeklyTitle: 'Еженедельная уборка',
    weeklyBody: (w) =>
      `На этой неделе ваша группа проводит еженедельную уборку. Окна: ${w}. Договоритесь о дне.`,
    weeklyBodyNoWindows:
      'На этой неделе ваша группа проводит еженедельную уборку. Договоритесь о дне.',
    plannedTitle: 'Еженедельная уборка сегодня',
    plannedBody: 'Через 2 часа ваша группа проводит еженедельную уборку зала.',
    generalTitle: 'Генеральная уборка сегодня',
    generalBody:
      'Через 2 часа — генеральная уборка зала. Приглашается всё собрание!',
  },
  en: {
    afterTitle: 'Cleaning after the meeting',
    afterBody:
      'Your group cleans the hall after the meeting today. Thank you for your work!',
    weeklyTitle: 'Weekly cleaning',
    weeklyBody: (w) =>
      `Your group does the weekly cleaning this week. Windows: ${w}. Please agree on a day.`,
    weeklyBodyNoWindows:
      'Your group does the weekly cleaning this week. Please agree on a day.',
    plannedTitle: 'Weekly cleaning today',
    plannedBody: 'Your group does the weekly hall cleaning in 2 hours.',
    generalTitle: 'General cleaning today',
    generalBody:
      'The general hall cleaning starts in 2 hours. The whole congregation is invited!',
  },
  de: {
    afterTitle: 'Reinigung nach der Zusammenkunft',
    afterBody:
      'Eure Gruppe reinigt heute den Saal nach der Zusammenkunft. Danke für euren Einsatz!',
    weeklyTitle: 'Wöchentliche Reinigung',
    weeklyBody: (w) =>
      `Eure Gruppe macht diese Woche die wöchentliche Reinigung. Fenster: ${w}. Stimmt einen Tag ab.`,
    weeklyBodyNoWindows:
      'Eure Gruppe macht diese Woche die wöchentliche Reinigung. Stimmt einen Tag ab.',
    plannedTitle: 'Wöchentliche Reinigung heute',
    plannedBody: 'Eure Gruppe reinigt in 2 Stunden den Saal.',
    generalTitle: 'Grundreinigung heute',
    generalBody:
      'In 2 Stunden beginnt die Grundreinigung des Saals. Die ganze Versammlung ist eingeladen!',
  },
};

@Injectable()
export class CleaningRemindersService {
  private readonly logger = new Logger(CleaningRemindersService.name);

  constructor(
    @InjectRepository(Congregation)
    private readonly congregationRepo: Repository<Congregation>,
    @InjectRepository(MeetingSettings)
    private readonly meetingSettingsRepo: Repository<MeetingSettings>,
    @InjectRepository(CleaningAssignment)
    private readonly cleaningRepo: Repository<CleaningAssignment>,
    @InjectRepository(ServiceGroup)
    private readonly groupRepo: Repository<ServiceGroup>,
    @InjectRepository(Publisher)
    private readonly publisherRepo: Repository<Publisher>,
    @InjectRepository(ReminderLog)
    private readonly logRepo: Repository<ReminderLog>,
    private readonly push: PushNotificationsService,
    private readonly notifications: NotificationsService,
    private readonly meetingAttendance: MeetingAttendanceService,
  ) {}

  /** Wall-clock parts for `now` in the given IANA timezone. */
  static localParts(now: Date, timezone: string): LocalParts {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    const parts = fmt.formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const year = Number(get('year'));
    const month = Number(get('month'));
    const day = Number(get('day'));
    let hour = Number(get('hour'));
    if (hour === 24) hour = 0; // some engines emit '24' at midnight
    const minute = Number(get('minute'));
    const wd = get('weekday');
    const map: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7,
    };
    const isoDow = map[wd] ?? 1;
    return {
      year,
      month,
      day,
      hour,
      minute,
      isoDow,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
        2,
        '0',
      )}`,
      minutesOfDay: hour * 60 + minute,
    };
  }

  /** True if `target` (minutes of day) falls in the current tick window. */
  private static hits(target: number, nowMinutes: number): boolean {
    return nowMinutes <= target && target < nowMinutes + TICK_MINUTES;
  }

  private static parseHm(hm: string): number {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  }

  /** Monday (YYYY-MM-DD) of the local week containing `date`. */
  private static mondayOf(date: string, isoDow: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (isoDow - 1));
    return d.toISOString().slice(0, 10);
  }

  private isQuiet(p: LocalParts): boolean {
    return p.hour >= QUIET_START || p.hour < QUIET_END;
  }

  /** Idempotent claim: returns true only for the first caller of this key. */
  private async claim(
    congregationId: string,
    kind: string,
    key: string,
  ): Promise<boolean> {
    try {
      await this.logRepo.insert({ congregationId, kind, key });
      return true;
    } catch {
      return false; // unique violation → already sent
    }
  }

  private async userIdsForGroup(
    congregationId: string,
    serviceGroupId: string,
  ): Promise<string[]> {
    const members = await this.publisherRepo.find({
      where: { congregationId, serviceGroupId },
    });
    return members
      .map((m) => m.userId)
      .filter((id): id is string => Boolean(id));
  }

  /** Entry point, called by the scheduler every TICK_MINUTES. */
  async runTick(now = new Date()): Promise<void> {
    const congregations = await this.congregationRepo.find();
    for (const cong of congregations) {
      try {
        await this.forCongregation(cong, now);
      } catch (err) {
        this.logger.error(
          `cleaning reminder tick failed for tenant=${cong.id}`,
          err as Error,
        );
      }
    }
  }

  private async forCongregation(cong: Congregation, now: Date): Promise<void> {
    const tz = cong.timezone || DEFAULT_CONGREGATION_TIMEZONE;
    const lang = coerceLanguage(cong.language);
    const s = STR[lang];
    const p = CleaningRemindersService.localParts(now, tz);
    if (this.isQuiet(p)) return;

    const settings = await this.meetingSettingsRepo.findOne({
      where: { congregationId: cong.id },
      order: { effectiveFrom: 'DESC' },
    });
    const weekStart = CleaningRemindersService.mondayOf(p.date, p.isoDow);

    const assignments = await this.cleaningRepo.find({
      where: { congregationId: cong.id, weekStartDate: weekStart },
    });
    const afterSlot = assignments.find(
      (a) => a.slotType === CleaningSlotType.AFTER_MEETING,
    );
    const thoroughSlot = assignments.find(
      (a) => a.slotType === CleaningSlotType.THOROUGH,
    );
    const generalSlot = assignments.find(
      (a) => a.slotType === CleaningSlotType.GENERAL,
    );

    // 1. After-meeting group: 2h before each meeting today.
    if (settings && afterSlot?.serviceGroupId) {
      // WHICH day holds a meeting is asked of the meeting rules, not derived
      // from the weekday in the settings. A circuit visit MOVES the midweek
      // meeting — so the reminder used to arrive on the ordinary Thursday when
      // nobody was there, and stay silent on the Tuesday when the group was
      // actually expected. A week replaced by an assembly now produces no
      // reminder at all, because there is no meeting to clean up after.
      // What the hall HOSTS, not what attendance is recorded for. The Memorial
      // takes a meeting away, so it is absent from the meetings list — and the
      // reminder used to stay silent on the one evening the hall is fullest.
      const gatherings = await this.meetingAttendance.gatheringsForWeek(
        cong.id,
        weekStart,
      );
      const today = gatherings.find((m) => m.date === p.date);
      const meetingToday = today
        ? {
            name: today.kind,
            // The visit moves the DAY; the hour still comes from the
            // congregation's settings, which is what the visit schedule
            // itself shows. The Memorial is the exception — it brings its own
            // hour, and reaching for the settings would put the reminder at
            // the time of a meeting that is not being held.
            time:
              today.kind === 'memorial'
                ? today.time
                : today.kind === 'midweek'
                  ? settings.midweekTime
                  : settings.weekendTime,
          }
        : null;
      // A Memorial with no hour recorded cannot be reminded about — two hours
      // before nothing is nothing. Skipped rather than RETURNED: the thorough,
      // weekly and general reminders below are separate slots and must still
      // run. (A `return` here was my first attempt and would have silenced
      // all three.)
      if (meetingToday?.time) {
        const target =
          CleaningRemindersService.parseHm(meetingToday.time) - LEAD_MINUTES;
        if (CleaningRemindersService.hits(target, p.minutesOfDay)) {
          const key = `${p.date}:${meetingToday.name}`;
          if (await this.claim(cong.id, 'cleaning_after_meeting', key)) {
            const users = await this.userIdsForGroup(
              cong.id,
              afterSlot.serviceGroupId,
            );
            await this.notifications.notify({
              tenantId: cong.id,
              userIds: users,
              title: s.afterTitle,
              body: s.afterBody,
              kind: 'cleaning_after_meeting',
              data: {
                type: 'cleaning_after_meeting',
                weekStart,
                meeting: meetingToday.name,
              },
            });
          }
        }
      }
    }

    // 2. Weekly group: guaranteed Monday morning reminder with windows.
    if (thoroughSlot?.serviceGroupId && p.isoDow === 1) {
      const target = MONDAY_HOUR * 60;
      if (CleaningRemindersService.hits(target, p.minutesOfDay)) {
        const key = `${weekStart}:monday`;
        if (await this.claim(cong.id, 'cleaning_weekly_monday', key)) {
          const users = await this.userIdsForGroup(
            cong.id,
            thoroughSlot.serviceGroupId,
          );
          const windows = thoroughSlot.windows ?? [];
          const body =
            windows.length > 0
              ? s.weeklyBody(windows.join(', '))
              : s.weeklyBodyNoWindows;
          await this.notifications.notify({
            tenantId: cong.id,
            userIds: users,
            title: s.weeklyTitle,
            body: body,
            kind: 'cleaning_weekly_monday',
            data: {
              type: 'cleaning_weekly_monday',
              weekStart,
              windows,
            },
          });
        }
      }
    }

    // 3. Weekly group: optional 2h-before push once a day was agreed.
    if (thoroughSlot?.serviceGroupId && thoroughSlot.thoroughPlannedAt) {
      const planned = CleaningRemindersService.localParts(
        new Date(thoroughSlot.thoroughPlannedAt),
        tz,
      );
      if (planned.date === p.date) {
        const target = planned.minutesOfDay - LEAD_MINUTES;
        if (CleaningRemindersService.hits(target, p.minutesOfDay)) {
          const key = `${weekStart}:planned:${planned.date}`;
          if (await this.claim(cong.id, 'cleaning_weekly_planned', key)) {
            const users = await this.userIdsForGroup(
              cong.id,
              thoroughSlot.serviceGroupId,
            );
            await this.notifications.notify({
              tenantId: cong.id,
              userIds: users,
              title: s.plannedTitle,
              body: s.plannedBody,
              kind: 'cleaning_weekly_planned',
              data: { type: 'cleaning_weekly_planned', weekStart },
            });
          }
        }
      }
    }

    // 4. General (annual) cleaning: 2h-before push to the WHOLE congregation
    // once the coordinator has set a date and time for it.
    if (generalSlot?.thoroughPlannedAt) {
      const planned = CleaningRemindersService.localParts(
        new Date(generalSlot.thoroughPlannedAt),
        tz,
      );
      if (planned.date === p.date) {
        const target = planned.minutesOfDay - LEAD_MINUTES;
        if (CleaningRemindersService.hits(target, p.minutesOfDay)) {
          const key = `${weekStart}:general:${planned.date}`;
          if (await this.claim(cong.id, 'cleaning_general_planned', key)) {
            const everyone = await this.publisherRepo.find({
              where: { congregationId: cong.id },
            });
            const users = everyone
              .map((m) => m.userId)
              .filter((id): id is string => Boolean(id));
            await this.notifications.notify({
              tenantId: cong.id,
              userIds: users,
              title: s.generalTitle,
              body: s.generalBody,
              kind: 'cleaning_general_planned',
              data: { type: 'cleaning_general_planned', weekStart },
            });
          }
        }
      }
    }
  }

  /** Housekeeping: drop ledger rows older than 60 days. */
  async cleanupOldLog(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const res = await this.logRepo
      .createQueryBuilder()
      .delete()
      .where('sent_at < :cutoff', { cutoff })
      .execute();
    return res.affected ?? 0;
  }
}
