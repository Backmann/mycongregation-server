import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { Absence } from '../entities/absence.entity';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentNotice } from '../entities/assignment-notice.entity';
import { Congregation } from '../entities/congregation.entity';
import { Duty } from '../entities/duty.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Publisher } from '../entities/publisher.entity';
import { PushToken } from '../entities/push-token.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { EventType } from '../common/enums/event-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  minutesOfDayIn,
  todayIn,
} from '../common/congregation-clock';
import { EVENT_TYPE_RESPONSIBILITY } from '../common/guards/assignment-section.guard';
import {
  coerceLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { MEETING_NAMES, PART_NAMES } from '../common/i18n/push-strings';
import { addDaysISO } from '../common/week-rules';
import { WeekRulesService } from '../common/week-rules.service';
import { mondayOf } from '../common/week';
import { NotificationsService } from '../notifications/notifications.service';
import { ReadinessService } from '../readiness/readiness.service';
import {
  daysBetween,
  labelOf,
  Ladder,
  MeetingKindOf,
  planDigest,
  ReminderItem,
  ReminderMark,
  shortDay,
  stepsFor,
  writeDigest,
} from './digest';

/** The digest goes out in the evening: after 18:00, before the quiet hours. */
const FROM_MINUTES = 18 * 60;
const UNTIL_MINUTES = 21 * 60;

/** How far ahead the ladder reaches, in days. */
const HORIZON_DAYS = 21;

/** A mark may sit on a meeting far ahead; a year of weeks is the ceiling. */
const MAX_WEEKS = 53;

/** How long a coordinator must have stopped editing before duties are said. */
const DUTY_SETTLE_MS = 5 * 60 * 1000;

/** Only duties changed this recently are announced on their own. */
const DUTY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** When the body responsible for a meeting hears what it still lacks. */
const GAP_STEPS = [7, 3];

const GAP_WORDS: Record<
  SupportedLanguage,
  {
    title: (day: string) => string;
    missing: string;
    absent: string;
  }
> = {
  ru: {
    title: (day) => `${day}: не всё готово`,
    missing: 'Без человека',
    absent: 'Отсутствует в этот день',
  },
  en: {
    title: (day) => `${day}: not everything is ready`,
    missing: 'Nobody assigned',
    absent: 'Away that day',
  },
  de: {
    title: (day) => `${day}: noch nicht alles bereit`,
    missing: 'Nicht besetzt',
    absent: 'An dem Tag abwesend',
  },
};

/** One person who is to hear about a change to a published meeting. */
export interface PendingNoticeRow {
  publisherId: string;
  displayName: string;
  tone: 'assigned' | 'removed';
  label: string;
  /** push — a device takes it; email — a letter; none — no way at all. */
  reach: 'push' | 'email' | 'none';
  /**
   * The evening on which the ladder would say it by itself, were nothing sent
   * now. Null when no evening is left before the meeting.
   */
  nextWord: string | null;
}

export interface PendingNotice {
  meetingDate: string | null;
  rows: PendingNoticeRow[];
  /** False when somebody would otherwise not hear before the meeting. */
  canWait: boolean;
  /** The first evening the ladder speaks of any of it, when waiting. */
  nextWord: string | null;
}

function ladderOf(user: Pick<User, 'reminderLadder'> | undefined): Ladder {
  return user?.reminderLadder === 'short' ? 'short' : 'full';
}

function toMark(n: AssignmentNotice): ReminderMark {
  return {
    type: n.itemType,
    id: n.itemId,
    date: String(n.meetingDate).slice(0, 10),
    kind: n.meetingKind,
    labelKey: n.labelKey,
    labelTitle: n.labelTitle,
    assistant: n.assistant,
    slot: n.slot,
  };
}

/**
 * The evening digest of a person's own assignments, and what hangs off it:
 * the record of what they were told, the word when an assignment is taken
 * away, and the note to whoever is responsible for a meeting that still has
 * a part without a person.
 *
 * The rules themselves live in digest.ts and are pure. This class fetches,
 * asks them, sends, and remembers.
 */
@Injectable()
export class AssignmentRemindersService {
  private readonly logger = new Logger(AssignmentRemindersService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Duty)
    private readonly duties: Repository<Duty>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(AssignmentNotice)
    private readonly notices: Repository<AssignmentNotice>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(PushToken)
    private readonly tokens: Repository<PushToken>,
    @InjectRepository(WebPushSubscription)
    private readonly subs: Repository<WebPushSubscription>,
    private readonly weekRules: WeekRulesService,
    private readonly readiness: ReadinessService,
    private readonly notifications: NotificationsService,
    @InjectRepository(FieldServiceMeeting)
    private readonly serviceMeetings: Repository<FieldServiceMeeting>,
  ) {}

  // -------------------------------------------------------------------------
  // The evening tick
  // -------------------------------------------------------------------------

  /**
   * Every quarter of an hour; speaks only in the evening of each
   * congregation's own clock. A repeated tick says nothing new: the digest
   * carries the day in its key.
   */
  async tick(now = new Date()): Promise<void> {
    const all = await this.congregations.find({
      select: { id: true, timezone: true },
    });
    for (const c of all) {
      const tz = c.timezone || DEFAULT_CONGREGATION_TIMEZONE;
      const minutes = minutesOfDayIn(now, tz);
      if (minutes < FROM_MINUTES || minutes >= UNTIL_MINUTES) continue;
      const today = todayIn(now, tz);
      try {
        await this.sendDigests(c.id, today);
        await this.sendGaps(c.id, today);
      } catch (err: any) {
        this.logger.error(
          `evening reminders failed for tenant=${c.id}`,
          err?.stack ?? err?.message ?? String(err),
        );
      }
    }
  }

  /** The meetings of a span of weeks, by `week|eventType`. */
  private async meetingDays(
    congregationId: string,
    fromWeek: string,
    weeks: number,
  ): Promise<Map<string, string>> {
    const starts: string[] = [];
    for (let i = 0; i < Math.min(weeks, MAX_WEEKS); i++) {
      starts.push(addDaysISO(fromWeek, i * 7));
    }
    const rules = await this.weekRules.forWeeks(congregationId, starts);
    const out = new Map<string, string>();
    for (const w of starts) {
      // Only the meetings actually HELD: a convention week has none, and the
      // Memorial takes one — its own notices speak for it.
      for (const m of rules.get(w)?.meetings ?? []) {
        out.set(`${w}|${m.kind}`, m.date);
      }
    }
    return out;
  }

  /**
   * Everything each person holds from today on, within the given weeks —
   * keyed by PUBLISHER, because that is what an assignment names.
   */
  private async itemsByPublisher(
    congregationId: string,
    today: string,
    weeks: number,
  ): Promise<Map<string, ReminderItem[]>> {
    const fromWeek = mondayOf(today);
    const lastWeek = addDaysISO(fromWeek, (Math.min(weeks, MAX_WEEKS) - 1) * 7);
    const [days, parts, duties, service] = await Promise.all([
      this.meetingDays(congregationId, fromWeek, weeks),
      this.assignments.find({
        where: {
          congregationId,
          status: AssignmentStatus.PUBLISHED,
          deletedAt: IsNull(),
          weekStartDate: Between(fromWeek, lastWeek),
        },
      }),
      this.duties.find({
        where: {
          congregationId,
          publisherId: Not(IsNull()),
          weekStartDate: Between(fromWeek, lastWeek),
        },
      }),
      // Only the next two weeks: a field-service meeting is recalled the
      // evening before and at no other time.
      this.serviceMeetings.find({
        where: {
          congregationId,
          weekStartDate: Between(fromWeek, addDaysISO(fromWeek, 7)),
        },
      }),
    ]);

    const out = new Map<string, ReminderItem[]>();
    const add = (publisherId: string | null, item: ReminderItem) => {
      if (!publisherId || item.date < today) return;
      out.set(publisherId, [...(out.get(publisherId) ?? []), item]);
    };

    for (const a of parts) {
      const kind = String(a.eventType);
      if (kind !== 'midweek' && kind !== 'weekend') continue;
      const date = days.get(`${a.weekStartDate}|${kind}`);
      if (!date) continue;
      const base = {
        type: 'part' as const,
        id: a.id,
        date,
        kind: kind as MeetingKindOf,
        labelKey: a.partKey,
        labelTitle: a.partTitle,
        slot: null,
      };
      add(a.publisherId, { ...base, assistant: false });
      add(a.assistantPublisherId, { ...base, assistant: true });
    }

    for (const m of service) {
      const item: ReminderItem = {
        type: 'service',
        id: m.id,
        date: addDaysISO(m.weekStartDate, m.dayOfWeek - 1),
        kind: 'service',
        labelKey: 'service',
        labelTitle: null,
        assistant: false,
        slot: null,
        time: m.startTime,
        place: m.address,
      };
      add(m.conductorPublisherId, item);
      // The service overseer's assistant goes to that group like the man
      // conducting, and is told of it the same way.
      if (
        m.serviceOverseerVisit &&
        m.serviceOverseerAssistantId !== m.conductorPublisherId
      ) {
        add(m.serviceOverseerAssistantId, item);
      }
    }

    // How many microphones a meeting has decides whether one is numbered.
    const mics = new Map<string, number>();
    for (const d of duties) {
      if (String(d.dutyType) !== 'microphone') continue;
      const k = `${d.weekStartDate}|${d.eventType}`;
      mics.set(k, (mics.get(k) ?? 0) + 1);
    }
    for (const d of duties) {
      const kind = String(d.eventType);
      if (kind !== 'midweek' && kind !== 'weekend') continue;
      const date = days.get(`${d.weekStartDate}|${kind}`);
      if (!date) continue;
      const type = String(d.dutyType);
      add(d.publisherId, {
        type: 'duty',
        id: d.id,
        date,
        kind: kind as MeetingKindOf,
        labelKey: type,
        labelTitle: d.customLabel,
        assistant: false,
        slot:
          type === 'microphone' &&
          (mics.get(`${d.weekStartDate}|${d.eventType}`) ?? 0) > 1
            ? d.slotIndex + 1
            : null,
      });
    }
    return out;
  }

  /** How many weeks must be read so that every mark's meeting is in view. */
  private weeksToCover(today: string, marks: AssignmentNotice[]): number {
    let last = addDaysISO(today, HORIZON_DAYS);
    for (const m of marks) {
      const d = String(m.meetingDate).slice(0, 10);
      if (d > last) last = d;
    }
    return Math.floor(daysBetween(mondayOf(today), mondayOf(last)) / 7) + 1;
  }

  private async saveMarks(
    congregationId: string,
    userId: string,
    items: ReminderItem[],
  ): Promise<void> {
    // Conducting a field-service meeting is never marked: see ItemType.
    const marked = items.filter((i) => i.type !== 'service');
    if (marked.length === 0) return;
    await this.notices.upsert(
      marked.map((i) => ({
        congregationId,
        userId,
        itemType: i.type as 'part' | 'duty',
        itemId: i.id,
        meetingDate: i.date,
        meetingKind: i.kind as 'midweek' | 'weekend',
        labelKey: i.labelKey,
        labelTitle: i.labelTitle,
        assistant: i.assistant,
        slot: i.slot,
      })),
      { conflictPaths: ['userId', 'itemType', 'itemId'] },
    );
  }

  private async dropMarks(userId: string, marks: ReminderMark[]) {
    for (const m of marks) {
      if (m.type === 'service') continue;
      await this.notices.delete({ userId, itemType: m.type, itemId: m.id });
    }
  }

  /** One evening's digests for one congregation. */
  async sendDigests(congregationId: string, today: string): Promise<number> {
    // History first: a mark whose meeting has passed has nothing left to say.
    await this.notices.delete({
      congregationId,
      meetingDate: LessThan(today),
    });
    const marks = await this.notices.find({ where: { congregationId } });
    const items = await this.itemsByPublisher(
      congregationId,
      today,
      this.weeksToCover(today, marks),
    );

    const cards = await this.publishers.find({
      where: { congregationId, userId: Not(IsNull()) },
      select: { id: true, userId: true },
    });
    const itemsByUser = new Map<string, ReminderItem[]>();
    for (const c of cards) {
      const mine = items.get(c.id);
      if (!mine || !c.userId) continue;
      itemsByUser.set(c.userId, [
        ...(itemsByUser.get(c.userId) ?? []),
        ...mine,
      ]);
    }
    const marksByUser = new Map<string, ReminderMark[]>();
    for (const m of marks) {
      marksByUser.set(m.userId, [
        ...(marksByUser.get(m.userId) ?? []),
        toMark(m),
      ]);
    }

    const userIds = [
      ...new Set([...itemsByUser.keys(), ...marksByUser.keys()]),
    ];
    if (userIds.length === 0) return 0;
    const users = await this.users.find({
      where: { id: In(userIds), isActive: true },
      select: { id: true, uiLanguage: true, reminderLadder: true },
    });

    let sent = 0;
    for (const user of users) {
      const plan = planDigest({
        today,
        ladder: ladderOf(user),
        items: itemsByUser.get(user.id) ?? [],
        marks: marksByUser.get(user.id) ?? [],
      });
      const text = writeDigest(plan.lines, coerceLanguage(user.uiLanguage));
      if (text) {
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: [user.id],
          title: text.title,
          body: text.body,
          kind: 'assignment_reminder',
          // One digest a person an evening, whatever falls due and however
          // many ticks pass.
          key: `digest:${today}:${user.id}`,
          data: { type: 'assignment_reminder' },
          emailFallback: true,
        });
        sent += 1;
      }
      await this.saveMarks(congregationId, user.id, plan.mark);
      await this.dropMarks(user.id, plan.forget);
    }
    return sent;
  }

  // -------------------------------------------------------------------------
  // Duties: said soon after they are given
  // -------------------------------------------------------------------------

  /**
   * A duty has no «опубликовать» and no «сообщить»: it is simply written in.
   * Until 3 October 2026 nothing told the person at all — and after the
   * ladder was built, only a week before and the evening before.
   *
   * So a duty is announced by itself, a few minutes after the coordinator has
   * stopped editing. The pause is the point: somebody filling in a month of
   * microphones saves forty times, and each brother should get ONE message
   * with all of his, not one per save. The same pass tells whoever was told
   * of a duty and no longer has it.
   *
   * Only what changed in the last day is announced this way. Everything older
   * that nobody was told about is left to the evening ladder — otherwise the
   * first run would announce every duty of the coming months to everybody.
   */
  async announceDuties(now = new Date()): Promise<number> {
    const settled = new Date(now.getTime() - DUTY_SETTLE_MS);
    const since = new Date(now.getTime() - DUTY_LOOKBACK_MS);
    const recent = await this.duties.find({
      where: { updatedAt: MoreThanOrEqual(since) },
    });
    const byCongregation = new Map<string, Duty[]>();
    for (const d of recent) {
      byCongregation.set(d.congregationId, [
        ...(byCongregation.get(d.congregationId) ?? []),
        d,
      ]);
    }
    // A removal leaves a mark behind and may leave no row at all, so every
    // congregation holding duty marks is looked at too.
    const marked = await this.notices.find({ where: { itemType: 'duty' } });
    for (const m of marked) {
      if (!byCongregation.has(m.congregationId)) {
        byCongregation.set(m.congregationId, []);
      }
    }

    let sent = 0;
    for (const [congregationId, rows] of byCongregation) {
      try {
        // Somebody is still editing: wait, and say it all at once.
        if (rows.some((d) => d.updatedAt > settled)) continue;
        sent += await this.announceDutiesOf(
          congregationId,
          rows,
          marked.filter((m) => m.congregationId === congregationId),
          now,
        );
      } catch (err: any) {
        this.logger.error(
          `duty notices failed for tenant=${congregationId}`,
          err?.stack ?? err?.message ?? String(err),
        );
      }
    }
    return sent;
  }

  private async announceDutiesOf(
    congregationId: string,
    recent: Duty[],
    marks: AssignmentNotice[],
    now: Date,
  ): Promise<number> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    const today = todayIn(now, c?.timezone || DEFAULT_CONGREGATION_TIMEZONE);

    // The duties the marks point at, as they are now.
    const markedRows = marks.length
      ? await this.duties.find({
          where: { congregationId, id: In(marks.map((m) => m.itemId)) },
        })
      : [];
    const rowById = new Map(
      [...markedRows, ...recent].map((d) => [d.id, d] as const),
    );

    const people = [
      ...new Set(
        [...rowById.values()]
          .map((d) => d.publisherId)
          .filter((x): x is string => !!x),
      ),
    ];
    // Nothing to ask about — and an empty OR would match every card there is.
    if (people.length === 0 && marks.length === 0) return 0;
    const cards = await this.publishers.find({
      where: [
        ...(people.length ? [{ congregationId, id: In(people) }] : []),
        ...(marks.length
          ? [{ congregationId, userId: In(marks.map((m) => m.userId)) }]
          : []),
      ],
      select: { id: true, userId: true },
    });
    const userOfCard = new Map(cards.map((p) => [p.id, p.userId]));
    const cardOfUser = new Map(cards.map((p) => [p.userId, p.id]));
    const told = new Set(marks.map((m) => `${m.userId}|${m.itemId}`));

    // Newly given: changed lately, held by somebody with a login who has not
    // been told, at a meeting that is still ahead.
    const fresh = recent.filter((d) => {
      const userId = d.publisherId ? userOfCard.get(d.publisherId) : null;
      return !!userId && !told.has(`${userId}|${d.id}`);
    });
    const weeks = [...new Set(fresh.map((d) => d.weekStartDate))].sort();
    const days = new Map<string, string>();
    if (weeks.length > 0) {
      const rules = await this.weekRules.forWeeks(congregationId, weeks);
      for (const w of weeks) {
        for (const m of rules.get(w)?.meetings ?? []) {
          days.set(`${w}|${m.kind}`, m.date);
        }
      }
    }
    // Whether a microphone is numbered depends on how many the meeting has.
    const micWeeks = fresh.filter((d) => String(d.dutyType) === 'microphone');
    const mics = new Map<string, number>();
    if (micWeeks.length > 0) {
      const all = await this.duties.find({
        where: {
          congregationId,
          weekStartDate: In([...new Set(micWeeks.map((d) => d.weekStartDate))]),
        },
      });
      for (const d of all) {
        if (String(d.dutyType) !== 'microphone') continue;
        const k = `${d.weekStartDate}|${d.eventType}`;
        mics.set(k, (mics.get(k) ?? 0) + 1);
      }
    }

    const newByUser = new Map<string, ReminderItem[]>();
    for (const d of fresh) {
      const kind = String(d.eventType);
      if (kind !== 'midweek' && kind !== 'weekend') continue;
      const date = days.get(`${d.weekStartDate}|${kind}`);
      if (!date || date < today) continue;
      const userId = userOfCard.get(d.publisherId!)!;
      const type = String(d.dutyType);
      newByUser.set(userId, [
        ...(newByUser.get(userId) ?? []),
        {
          type: 'duty',
          id: d.id,
          date,
          kind: kind as MeetingKindOf,
          labelKey: type,
          labelTitle: d.customLabel,
          assistant: false,
          slot:
            type === 'microphone' &&
            (mics.get(`${d.weekStartDate}|${d.eventType}`) ?? 0) > 1
              ? d.slotIndex + 1
              : null,
        },
      ]);
    }

    // Taken away: told of it, and the duty is gone or is somebody else's now.
    const goneByUser = new Map<string, AssignmentNotice[]>();
    for (const m of marks) {
      const row = rowById.get(m.itemId);
      const card = cardOfUser.get(m.userId);
      if (row && card && row.publisherId === card) continue;
      goneByUser.set(m.userId, [...(goneByUser.get(m.userId) ?? []), m]);
    }

    const userIds = [...new Set([...newByUser.keys(), ...goneByUser.keys()])];
    if (userIds.length === 0) return 0;
    const users = await this.users.find({
      where: { id: In(userIds), isActive: true },
      select: { id: true, uiLanguage: true },
    });
    // A press of nothing: the stamp only keeps two overlapping passes from
    // saying the same thing twice. The marks are what prevents a repeat.
    const stamp = Math.floor(now.getTime() / 10_000).toString(36);

    let sent = 0;
    for (const u of users) {
      const given = newByUser.get(u.id) ?? [];
      const gone = (goneByUser.get(u.id) ?? []).map(toMark);
      const lines = [
        ...given.map((item) => ({
          tone: 'new' as const,
          item,
          daysLeft: daysBetween(today, item.date),
        })),
        ...gone
          .filter((m) => m.date >= today)
          .map((item) => ({
            tone: 'cancelled' as const,
            item,
            daysLeft: daysBetween(today, item.date),
          })),
      ].sort((a, b) => a.item.date.localeCompare(b.item.date));
      const text = writeDigest(lines, coerceLanguage(u.uiLanguage));
      if (text) {
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: [u.id],
          title: text.title,
          body: text.body,
          kind: 'assignment_reminder',
          key: `duties:${stamp}:${u.id}`,
          data: { type: 'assignment_reminder' },
          emailFallback: true,
        });
        sent += 1;
      }
      await this.saveMarks(congregationId, u.id, given);
      await this.dropMarks(u.id, gone);
    }
    return sent;
  }

  // -------------------------------------------------------------------------
  // Said at once: a meeting published or changed with «сообщить сейчас»
  // -------------------------------------------------------------------------

  /** The calendar day of one meeting, or null when it is not held. */
  private async dayOf(
    congregationId: string,
    weekStartDate: string,
    kind: MeetingKindOf,
  ): Promise<string | null> {
    const rules = await this.weekRules.forWeek(congregationId, weekStartDate);
    return rules.meetings.find((m) => m.kind === kind)?.date ?? null;
  }

  /**
   * These rows have just been announced to their assignees: remember it, so
   * the ladder recalls them instead of announcing them a second time.
   */
  async markTold(
    congregationId: string,
    weekStartDate: string,
    kind: MeetingKindOf,
    rows: Assignment[],
  ): Promise<void> {
    try {
      const date = await this.dayOf(congregationId, weekStartDate, kind);
      if (!date) return;
      const ids = [
        ...new Set(
          rows
            .flatMap((r) => [r.publisherId, r.assistantPublisherId])
            .filter((x): x is string => !!x),
        ),
      ];
      if (ids.length === 0) return;
      const cards = await this.publishers.find({
        where: { congregationId, id: In(ids) },
        select: { id: true, userId: true },
      });
      const userOf = new Map(cards.map((c) => [c.id, c.userId]));
      for (const r of rows) {
        for (const [publisherId, assistant] of [
          [r.publisherId, false],
          [r.assistantPublisherId, true],
        ] as const) {
          const userId = publisherId ? userOf.get(publisherId) : null;
          if (!userId) continue;
          await this.saveMarks(congregationId, userId, [
            {
              type: 'part',
              id: r.id,
              date,
              kind,
              labelKey: r.partKey,
              labelTitle: r.partTitle,
              assistant,
              slot: null,
            },
          ]);
        }
      }
    } catch (err: any) {
      this.logger.warn(`markTold failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Which of these parts each of these people has already been told of —
   * as `userId|assignmentId`.
   */
  async toldParts(
    congregationId: string,
    userIds: string[],
    assignmentIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0 || assignmentIds.length === 0) return new Set();
    const marks = await this.notices.find({
      where: {
        congregationId,
        itemType: 'part',
        userId: In(userIds),
        itemId: In(assignmentIds),
      },
      select: { userId: true, itemId: true },
    });
    return new Set(marks.map((m) => `${m.userId}|${m.itemId}`));
  }

  /** Marks on this meeting whose item is no longer that person's. */
  private async staleMarks(
    congregationId: string,
    weekStartDate: string,
    kind: MeetingKindOf,
  ): Promise<AssignmentNotice[]> {
    const eventType =
      kind === 'midweek' ? EventType.MIDWEEK : EventType.WEEKEND;
    const rows = await this.assignments.find({
      where: { congregationId, weekStartDate, eventType },
      withDeleted: true,
    });
    if (rows.length === 0) return [];
    const marks = await this.notices.find({
      where: {
        congregationId,
        itemType: 'part',
        itemId: In(rows.map((r) => r.id)),
      },
    });
    if (marks.length === 0) return [];
    const cards = await this.publishers.find({
      where: { congregationId, userId: In(marks.map((m) => m.userId)) },
      select: { id: true, userId: true },
    });
    const cardOf = new Map(cards.map((c) => [c.userId, c.id]));
    const rowById = new Map(rows.map((r) => [r.id, r]));
    return marks.filter((m) => {
      const r = rowById.get(m.itemId);
      const card = cardOf.get(m.userId);
      if (!r || !card) return true;
      if (r.deletedAt || r.status !== AssignmentStatus.PUBLISHED) return true;
      return m.assistant
        ? r.assistantPublisherId !== card
        : r.publisherId !== card;
    });
  }

  /**
   * Whoever was told of a part on this meeting and no longer has it hears so
   * NOW — the «сообщить сейчас» half of a change. Left alone, the evening
   * digest says the same thing tonight.
   */
  async announceRemovals(
    congregationId: string,
    weekStartDate: string,
    kind: MeetingKindOf,
  ): Promise<number> {
    try {
      const today = await this.todayOf(congregationId);
      const stale = await this.staleMarks(congregationId, weekStartDate, kind);
      const byUser = new Map<string, AssignmentNotice[]>();
      for (const m of stale) {
        byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m]);
      }
      if (byUser.size === 0) return 0;
      const users = await this.users.find({
        where: { id: In([...byUser.keys()]) },
        select: { id: true, uiLanguage: true },
      });
      const langOf = new Map(
        users.map((u) => [u.id, coerceLanguage(u.uiLanguage)]),
      );
      for (const [userId, mine] of byUser) {
        const lines = mine
          .map(toMark)
          .map((item) => ({
            tone: 'cancelled' as const,
            item,
            daysLeft: daysBetween(today, item.date),
          }))
          .filter((l) => l.daysLeft >= 0);
        const text = writeDigest(lines, langOf.get(userId) ?? 'ru');
        if (text) {
          await this.notifications.notify({
            tenantId: congregationId,
            userIds: [userId],
            title: text.title,
            body: text.body,
            kind: 'schedule',
            // A press, not a day: taken away twice on one day is said
            // twice. The marks are dropped below, so it cannot repeat itself.
            key: `schedule:${weekStartDate}:${kind}:removed:${Math.floor(
              Date.now() / 10_000,
            ).toString(36)}:${userId}`,
            data: { type: 'schedule_changed', eventType: kind, weekStartDate },
            emailFallback: true,
          });
        }
        await this.dropMarks(userId, mine.map(toMark));
      }
      return byUser.size;
    } catch (err: any) {
      this.logger.warn(`announceRemovals failed: ${err?.message ?? err}`);
      return 0;
    }
  }

  private async todayOf(congregationId: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone || DEFAULT_CONGREGATION_TIMEZONE);
  }

  // -------------------------------------------------------------------------
  // What the window after an edit shows: who would hear, and when otherwise
  // -------------------------------------------------------------------------

  /**
   * The evening on which the ladder first speaks of an item heard of by
   * nobody — tonight if it is a step and the digest has not gone yet,
   * otherwise the next step down. Null when none is left.
   */
  static nextWord(input: {
    today: string;
    /** Minutes into the congregation's day. */
    minutes: number;
    meetingDate: string;
    steps: readonly number[];
  }): string | null {
    const left = daysBetween(input.today, input.meetingDate);
    for (const step of [...input.steps].sort((a, b) => b - a)) {
      if (step > left) continue;
      if (step === left && input.minutes >= FROM_MINUTES) continue;
      return addDaysISO(input.meetingDate, -step);
    }
    return null;
  }

  async pendingNotice(
    congregationId: string,
    weekStartDate: string,
    kind: MeetingKindOf,
    now = new Date(),
  ): Promise<PendingNotice> {
    const eventType =
      kind === 'midweek' ? EventType.MIDWEEK : EventType.WEEKEND;
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true, language: true },
    });
    const tz = c?.timezone || DEFAULT_CONGREGATION_TIMEZONE;
    const lang = coerceLanguage(c?.language);
    const today = todayIn(now, tz);
    const minutes = minutesOfDayIn(now, tz);
    const meetingDate = await this.dayOf(congregationId, weekStartDate, kind);

    const [changed, stale] = await Promise.all([
      this.assignments.find({
        where: {
          congregationId,
          weekStartDate,
          eventType,
          changedSincePublish: true,
        },
        order: { partOrder: 'ASC' },
      }),
      this.staleMarks(congregationId, weekStartDate, kind),
    ]);

    type Draft = Omit<PendingNoticeRow, 'displayName' | 'reach'> & {
      userId: string | null;
    };
    const drafts: Draft[] = [];
    for (const a of changed) {
      for (const [publisherId, assistant] of [
        [a.publisherId, false],
        [a.assistantPublisherId, true],
      ] as const) {
        if (!publisherId) continue;
        drafts.push({
          publisherId,
          userId: null,
          tone: 'assigned',
          label: labelOf(
            {
              type: 'part',
              labelKey: a.partKey,
              labelTitle: a.partTitle,
              assistant,
              slot: null,
            },
            lang,
          ),
          nextWord: null,
        });
      }
    }

    const staleCards = stale.length
      ? await this.publishers.find({
          where: { congregationId, userId: In(stale.map((m) => m.userId)) },
          select: { id: true, userId: true },
        })
      : [];
    const cardOfUser = new Map(staleCards.map((p) => [p.userId, p.id]));
    for (const m of stale) {
      const publisherId = cardOfUser.get(m.userId);
      if (!publisherId) continue;
      drafts.push({
        publisherId,
        userId: m.userId,
        tone: 'removed',
        label: labelOf(toMark(m), lang),
        nextWord: null,
      });
    }

    const cards = drafts.length
      ? await this.publishers.find({
          where: {
            congregationId,
            id: In([...new Set(drafts.map((d) => d.publisherId))]),
          },
          select: { id: true, userId: true, displayName: true },
        })
      : [];
    const cardById = new Map(cards.map((p) => [p.id, p]));
    const userIds = cards.map((p) => p.userId).filter((x): x is string => !!x);
    const [users, tokens, subs] = userIds.length
      ? await Promise.all([
          this.users.find({
            where: { id: In(userIds), isActive: true },
            select: { id: true, email: true, reminderLadder: true },
          }),
          this.tokens.find({
            where: { userId: In(userIds) },
            select: { userId: true },
          }),
          this.subs.find({
            where: { userId: In(userIds) },
            select: { userId: true },
          }),
        ])
      : [[], [], []];
    const userById = new Map(users.map((u) => [u.id, u]));
    const hasDevice = new Set([
      ...tokens.map((t) => t.userId),
      ...subs.map((s) => s.userId),
    ]);

    const rows: PendingNoticeRow[] = drafts.map((d) => {
      const card = cardById.get(d.publisherId);
      const user = card?.userId ? userById.get(card.userId) : undefined;
      const reach: PendingNoticeRow['reach'] = !user
        ? 'none'
        : hasDevice.has(user.id)
          ? 'push'
          : user.email
            ? 'email'
            : 'none';
      let nextWord: string | null = null;
      if (meetingDate) {
        nextWord =
          d.tone === 'removed'
            ? // A cancellation waits for no step: tonight, or tomorrow evening
              // if tonight's digest has gone — while the meeting is still ahead.
              (() => {
                const evening =
                  minutes < FROM_MINUTES ? today : addDaysISO(today, 1);
                return evening < meetingDate ? evening : null;
              })()
            : AssignmentRemindersService.nextWord({
                today,
                minutes,
                meetingDate,
                steps: stepsFor('part', ladderOf(user)),
              });
      }
      return {
        publisherId: d.publisherId,
        displayName: card?.displayName ?? '',
        tone: d.tone,
        label: d.label,
        reach,
        nextWord,
      };
    });

    // Waiting is honest only if every person WHO CAN BE REACHED would still
    // hear before the meeting. Somebody with no login hears from nobody either
    // way, and must not hold the others to «сейчас».
    const reachable = rows.filter((r) => r.reach !== 'none');
    const canWait = reachable.every((r) => r.nextWord !== null);
    const dates = reachable
      .map((r) => r.nextWord)
      .filter((x): x is string => !!x)
      .sort();
    return { meetingDate, rows, canWait, nextWord: dates[0] ?? null };
  }

  // -------------------------------------------------------------------------
  // To whoever is responsible for a meeting: what it still lacks
  // -------------------------------------------------------------------------

  /**
   * Seven and three days before a meeting, one message to those responsible
   * for it — if a part has no person, or the person is away that day.
   *
   * The programme is JUDGED and the duties only counted (see readiness): an
   * empty duty may simply not be wanted that evening, so it is not reported.
   */
  async sendGaps(congregationId: string, today: string): Promise<number> {
    const from = mondayOf(today);
    const weeks = await this.readiness.forRange(
      congregationId,
      from,
      addDaysISO(from, 14),
    );
    let sent = 0;
    for (const w of weeks) {
      for (const m of w.meetings) {
        const left = daysBetween(today, m.date);
        if (!GAP_STEPS.includes(left)) continue;
        if (!m.programme.loaded) continue;
        const eventType =
          m.kind === 'midweek' ? EventType.MIDWEEK : EventType.WEEKEND;

        const held = await this.assignments.find({
          where: {
            congregationId,
            weekStartDate: w.weekStart,
            eventType,
            deletedAt: IsNull(),
            status: Not(AssignmentStatus.CANCELLED),
          },
        });
        const people = [
          ...new Set(
            held
              .flatMap((a) => [a.publisherId, a.assistantPublisherId])
              .filter((x): x is string => !!x),
          ),
        ];
        const away = people.length
          ? await this.absences.find({
              where: { congregationId, publisherId: In(people) },
            })
          : [];
        const awayIds = new Set(
          away
            .filter(
              (a) =>
                a.startDate <= m.date && (a.endDate ?? a.startDate) >= m.date,
            )
            .map((a) => a.publisherId),
        );
        if (m.programme.missing.length === 0 && awayIds.size === 0) continue;

        const names = awayIds.size
          ? await this.publishers.find({
              where: { congregationId, id: In([...awayIds]) },
              select: { id: true, displayName: true },
            })
          : [];
        const nameOf = new Map(names.map((p) => [p.id, p.displayName]));

        const holders = await this.responsibilities.find({
          where: {
            congregationId,
            type: In(EVENT_TYPE_RESPONSIBILITY[eventType]),
          },
        });
        let recipients = [...new Set(holders.map((h) => h.userId))].filter(
          Boolean,
        );
        if (recipients.length === 0) {
          // Nobody holds the responsibility: the administrators hear instead,
          // as they do for the report reminders. A gap nobody is told of is
          // the very thing this message exists to prevent.
          const admins = await this.users.find({
            where: { congregationId, role: UserRole.ADMIN, isActive: true },
            select: { id: true },
          });
          recipients = admins.map((a) => a.id);
        }
        if (recipients.length === 0) continue;
        const users = await this.users.find({
          where: { id: In(recipients), isActive: true },
          select: { id: true, uiLanguage: true },
        });

        for (const u of users) {
          const lang = coerceLanguage(u.uiLanguage);
          const words = GAP_WORDS[lang];
          const lines: string[] = [];
          if (m.programme.missing.length > 0) {
            lines.push(
              `${words.missing}: ${m.programme.missing
                .map((k) => PART_NAMES[lang][k] ?? k)
                .join(', ')}`,
            );
          }
          if (awayIds.size > 0) {
            const who = held
              .flatMap((a) => [
                [a.publisherId, a] as const,
                [a.assistantPublisherId, a] as const,
              ])
              .filter(([id]) => id && awayIds.has(id))
              .map(
                ([id, a]) =>
                  `${nameOf.get(id!) ?? ''} (${
                    a.partTitle?.trim() || PART_NAMES[lang][a.partKey] || ''
                  })`,
              );
            lines.push(`${words.absent}: ${[...new Set(who)].join(', ')}`);
          }
          await this.notifications.notify({
            tenantId: congregationId,
            userIds: [u.id],
            title: words.title(
              `${shortDay(m.date, lang)}, ${MEETING_NAMES[m.kind][lang]}`,
            ),
            body: lines.join('\n'),
            kind: 'meeting_gaps',
            key: `gaps:${m.date}:${m.kind}:${left}`,
            data: {
              type: 'meeting_gaps',
              eventType: m.kind,
              weekStartDate: w.weekStart,
            },
          });
          sent += 1;
        }
      }
    }
    return sent;
  }
}
