import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Publisher } from '../entities/publisher.entity';
import { ReminderLog } from '../entities/reminder-log.entity';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import {
  coerceLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';

const DEFAULT_TZ = 'Europe/Berlin';
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
    const tz = cong.timezone || DEFAULT_TZ;
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
      const meetingToday =
        p.isoDow === settings.midweekDow
          ? { name: 'midweek', time: settings.midweekTime }
          : p.isoDow === settings.weekendDow
            ? { name: 'weekend', time: settings.weekendTime }
            : null;
      if (meetingToday) {
        const target =
          CleaningRemindersService.parseHm(meetingToday.time) - LEAD_MINUTES;
        if (CleaningRemindersService.hits(target, p.minutesOfDay)) {
          const key = `${p.date}:${meetingToday.name}`;
          if (await this.claim(cong.id, 'cleaning_after_meeting', key)) {
            const users = await this.userIdsForGroup(
              cong.id,
              afterSlot.serviceGroupId,
            );
            await this.push.sendToUsers(
              cong.id,
              users,
              s.afterTitle,
              s.afterBody,
              {
                type: 'cleaning_after_meeting',
                weekStart,
                meeting: meetingToday.name,
              },
            );
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
          await this.push.sendToUsers(cong.id, users, s.weeklyTitle, body, {
            type: 'cleaning_weekly_monday',
            weekStart,
            windows,
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
            await this.push.sendToUsers(
              cong.id,
              users,
              s.plannedTitle,
              s.plannedBody,
              { type: 'cleaning_weekly_planned', weekStart },
            );
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
            await this.push.sendToUsers(
              cong.id,
              users,
              s.generalTitle,
              s.generalBody,
              { type: 'cleaning_general_planned', weekStart },
            );
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
