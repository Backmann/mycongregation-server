import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { Absence } from '../entities/absence.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { EventType } from '../common/enums/event-type.enum';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  minutesOfDayIn,
  todayIn,
} from '../common/congregation-clock';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import { NotificationsService } from '../notifications/notifications.service';
import {
  MeetingAttendanceService,
  minutesOfClock,
} from './meeting-attendance.service';

/** 20:00 — the hour Lionel chose (31 October 2026). */
export const REMIND_AT_MINUTES = 20 * 60;

/**
 * The words of the reminder — short, in each language, pure so they can be
 * read in one place.
 */
export function attendanceDueText(
  kind: EventType,
  lang: SupportedLanguage,
): { title: string; body: string } {
  const T = {
    ru: {
      title: 'Посещаемость встречи',
      midweek: 'Будняя встреча сегодня ещё не внесена.',
      weekend: 'Выходная встреча сегодня ещё не внесена.',
      memorial: 'Вечеря воспоминания сегодня ещё не внесена.',
    },
    de: {
      title: 'Anwesenheit der Zusammenkunft',
      midweek:
        'Die Zusammenkunft unter der Woche ist heute noch nicht eingetragen.',
      weekend:
        'Die Zusammenkunft am Wochenende ist heute noch nicht eingetragen.',
      memorial: 'Das Gedächtnismahl ist heute noch nicht eingetragen.',
    },
    en: {
      title: 'Meeting attendance',
      midweek: 'Today’s midweek meeting has not been recorded yet.',
      weekend: 'Today’s weekend meeting has not been recorded yet.',
      memorial: 'Today’s Memorial has not been recorded yet.',
    },
  }[lang] ?? {
    title: 'Посещаемость встречи',
    midweek: 'Будняя встреча сегодня ещё не внесена.',
    weekend: 'Выходная встреча сегодня ещё не внесена.',
    memorial: 'Вечеря воспоминания сегодня ещё не внесена.',
  };
  const body =
    kind === EventType.MEMORIAL
      ? T.memorial
      : kind === EventType.MIDWEEK
        ? T.midweek
        : T.weekend;
  return { title: T.title, body };
}

/**
 * «Посещаемость встречи — … сегодня ещё не внесена» at 20:00 (31 October 2026).
 *
 * ONE person is told, not everyone who may enter the figure: when four are
 * told, two enter it. The chain, Lionel's: the brother who counts; if he is
 * away that day or nobody holds the duty, the one who stands in for him; if
 * there is none, the secretary.
 *
 * Only for a meeting that began before 20:00 — a later one has its card, and
 * the hour is past the meeting it would be about. Said once: the key carries
 * the meeting.
 */
@Injectable()
export class AttendanceReminderService {
  constructor(
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    private readonly attendance: MeetingAttendanceService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Run every quarter of an hour; acts in the congregation's 20:00 hour. */
  async run(now: Date = new Date()): Promise<number> {
    const congs = await this.congregations.find({
      select: { id: true, timezone: true },
    });
    let sent = 0;
    for (const c of congs) {
      const tz = c.timezone || DEFAULT_CONGREGATION_TIMEZONE;
      const minutes = minutesOfDayIn(now, tz);
      // From 20:00 until the quiet hours: a late tick still says it, the key
      // keeps it to once.
      if (minutes < REMIND_AT_MINUTES || minutes >= REMIND_AT_MINUTES + 60) {
        continue;
      }
      sent += await this.remindFor(c.id, todayIn(now, tz));
    }
    return sent;
  }

  async remindFor(tenantId: string, today: string): Promise<number> {
    const due = (await this.attendance.unrecordedToday(tenantId, today)).filter(
      (m) => {
        const start = minutesOfClock(m.time);
        return start === null || start < REMIND_AT_MINUTES;
      },
    );
    if (due.length === 0) return 0;
    const userId = await this.whoIsTold(tenantId, today);
    if (!userId) return 0;
    for (const m of due) {
      await this.notifications.notify({
        tenantId,
        userIds: [userId],
        text: (lang) => attendanceDueText(m.eventType, lang),
        kind: 'attendance_due',
        key: `attendance-due:${m.date}:${m.eventType}`,
        data: { type: 'attendance_due', date: m.date, eventType: m.eventType },
      });
    }
    return due.length;
  }

  /** The first in the chain who holds the duty and is not away today. */
  async whoIsTold(tenantId: string, today: string): Promise<string | null> {
    const chain = [
      ResponsibilityType.ATTENDANCE_RECORDER,
      ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
    ];
    const held = await this.responsibilities.find({
      where: {
        congregationId: tenantId,
        type: In([...chain, ResponsibilityType.SECRETARY]),
      },
    });
    const userIds = [...new Set(held.map((r) => r.userId))];
    const cards = userIds.length
      ? await this.publishers.find({
          where: { congregationId: tenantId, userId: In(userIds) },
          select: { id: true, userId: true },
        })
      : [];
    const away = cards.length
      ? await this.absences.find({
          where: [
            {
              congregationId: tenantId,
              publisherId: In(cards.map((c) => c.id)),
              startDate: LessThanOrEqual(today),
              endDate: MoreThanOrEqual(today),
            },
            {
              congregationId: tenantId,
              publisherId: In(cards.map((c) => c.id)),
              startDate: LessThanOrEqual(today),
              endDate: IsNull(),
            },
          ],
          select: { id: true, publisherId: true },
        })
      : [];
    const awayCards = new Set(away.map((a) => a.publisherId));
    const isAway = (userId: string) =>
      cards.some((c) => c.userId === userId && awayCards.has(c.id));

    for (const type of chain) {
      const here = held.find((r) => r.type === type && !isAway(r.userId));
      if (here) return here.userId;
    }
    // The secretary keeps the sheet: he is told even when away — somebody
    // has to be, and he can hand it on.
    return (
      held.find((r) => r.type === ResponsibilityType.SECRETARY)?.userId ?? null
    );
  }
}
