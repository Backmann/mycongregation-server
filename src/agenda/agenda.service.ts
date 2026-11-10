import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, In, IsNull, Not } from 'typeorm';
import { Absence } from '../entities/absence.entity';
import { Assignment } from '../entities/assignment.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { Duty } from '../entities/duty.entity';
import { EldersMeeting } from '../entities/elders-meeting.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Hall } from '../entities/hall.entity';
import { MemorialItem } from '../entities/memorial-item.entity';
import { PioneerMeeting } from '../entities/pioneer-meeting.entity';
import {
  conductorIdsOf,
  conductorsOf,
} from '../pioneer-meetings/pioneer-meeting-rules';
import { PioneerSchoolDuty } from '../entities/pioneer-school-duty.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Publisher } from '../entities/publisher.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import { User } from '../entities/user.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { CongregationClock } from '../common/congregation-clock.service';
import { localDateParts, minutesOfDayIn } from '../common/congregation-clock';
import { mondayOf } from '../common/week';
import { addDaysISO, MeetingKind, WeekRules } from '../common/week-rules';
import { WeekRulesService } from '../common/week-rules.service';
import { isActivePermanentPioneer } from '../common/pioneer-status';
import { invitedOn } from '../pioneer-meetings/pioneer-meeting-rules';
import { AuxiliaryPioneersService } from '../auxiliary-pioneers/auxiliary-pioneers.service';
import {
  merge as cartMerge,
  minus as cartMinus,
  overlaps as cartOverlaps,
} from '../cart-weeks/cart-time';
import { DUTY_NAMES, labelOf } from '../assignment-reminders/digest';
import { AGENDA_WORDS, BIG_EVENT_TYPES } from './agenda-words';
import {
  INVITE_ONLY_TYPES,
  inviteesOf,
  isInvited,
} from '../special-events/invitations';
import { Agenda, AgendaItem, AgendaKind, NotHeldReason } from './agenda.types';

/** A congregation meeting lasts this long, both of them (7 November 2026, Lionel). */
export const MEETING_MINUTES = 105;
/** The widest span one read may ask for: a year back and a year ahead. */
export const MAX_SPAN_DAYS = 2 * 366;

/** HH:mm plus minutes, kept inside the day (a calendar event must not end before it starts). */
export function plusMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const hhmm = (t: string | null | undefined): string | null =>
  t ? String(t).slice(0, 5) : null;
const day = (d: string | Date): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const nameOf = (
  p: { firstName?: string | null; lastName?: string | null },
  lastNameFirst = false,
) =>
  (lastNameFirst ? [p.lastName, p.firstName] : [p.firstName, p.lastName])
    .filter(Boolean)
    .join(' ')
    .trim();

/** Parts whose programme line says nothing of their own. */
const NO_DETAIL = new Set([
  'midweek_chairman',
  'midweek_opening_prayer',
  'midweek_closing_prayer',
  'weekend_chairman',
  'weekend_opening_prayer',
  'weekend_closing_prayer',
]);

/**
 * Where a part stands in its meeting (10 November 2026). Every part of one
 * meeting carries the meeting's hour, so the hour cannot order them, and
 * the row id is random: a calendar read «Заключительная молитва» before
 * «Председатель». The programme's own order: the chairman and the opening
 * prayer first, the closing prayer last, the parts between by their place
 * in the programme.
 */
const OPENING_PARTS = [
  'midweek_chairman',
  'midweek_opening_prayer',
  'weekend_chairman',
  'weekend_opening_prayer',
];
const CLOSING_PARTS = new Set([
  'midweek_closing_prayer',
  'weekend_closing_prayer',
]);
export function partRank(partKey: string, partOrder: number): number {
  const opening = OPENING_PARTS.indexOf(partKey);
  if (opening >= 0) return opening % 2;
  if (CLOSING_PARTS.has(partKey)) return 1_000_000;
  return 1000 + (partOrder || 0);
}

/** The order of things on one day when they share an hour (or have none). */
const KIND_ORDER: Record<AgendaKind, number> = {
  event: 0,
  elders_meeting: 1,
  co_visit: 2,
  pioneer_school: 3,
  pioneer_meeting: 4,
  field_service: 5,
  cart: 6,
  part: 7,
  duty: 8,
  cleaning: 9,
  outgoing_talk: 10,
  guest_lunch: 11,
};

export interface AgendaOptions {
  from?: string;
  to?: string;
  /** Names of the people one does it with; on by default. */
  withNames?: boolean;
  /**
   * «Кляйн Лена» as the app writes people, instead of the calendar's
   * «Лена Кляйн» — for Home's «изменено» (9 November 2026).
   */
  lastNameFirst?: boolean;
  /** The reader's language; the login's own when not given. */
  lang?: SupportedLanguage;
}

/**
 * Builds one person's agenda (see agenda.types.ts).
 *
 * Only what has been MADE KNOWN is read: a published programme, a published
 * cart week, a published field-service meeting, a Memorial whose programme is
 * out. A draft is nobody's business yet, least of all a phone's calendar.
 */
@Injectable()
export class AgendaService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
    private readonly auxPioneers: AuxiliaryPioneersService,
  ) {}

  /** The agenda of the publisher linked to this login. */
  async forUser(
    congregationId: string,
    userId: string,
    opts: AgendaOptions = {},
  ): Promise<Agenda> {
    const me = await this.ds.getRepository(Publisher).findOne({
      where: { congregationId, userId },
    });
    const lang = opts.lang ?? (await this.languageOf(userId));
    if (!me) {
      const { from, to } = await this.span(congregationId, opts);
      return { publisherId: null, from, to, items: [] };
    }
    return this.forPublisher(congregationId, me, { ...opts, lang });
  }

  /** The language the person reads the app in — and so the agenda's words. */
  async languageOf(userId: string): Promise<SupportedLanguage> {
    const user = await this.ds
      .getRepository(User)
      .findOne({ where: { id: userId } });
    return user && isSupportedLanguage(user.uiLanguage)
      ? user.uiLanguage
      : DEFAULT_LANGUAGE;
  }

  /** From/to as asked, or today and a year on; never wider than MAX_SPAN_DAYS. */
  async span(
    congregationId: string,
    opts: AgendaOptions,
  ): Promise<{ from: string; to: string; today: string }> {
    const today = await this.clock.todayFor(congregationId);
    const from = opts.from ?? today;
    let to = opts.to ?? addDaysISO(today, 365);
    if (to < from) to = from;
    if (to > addDaysISO(from, MAX_SPAN_DAYS))
      to = addDaysISO(from, MAX_SPAN_DAYS);
    return { from, to, today };
  }

  async forPublisher(
    congregationId: string,
    me: Publisher,
    opts: AgendaOptions = {},
  ): Promise<Agenda> {
    const lang = opts.lang ?? DEFAULT_LANGUAGE;
    const withNames = opts.withNames ?? true;
    const words = AGENDA_WORDS[lang];
    const { from, to, today } = await this.span(congregationId, opts);
    const pid = me.id;
    const firstWeek = mondayOf(from);
    const items: AgendaItem[] = [];
    const inSpan = (d: string) => d >= from && d <= to;

    // ── The week rules: one context, a week's rules made on demand ─────────
    const ctx = await this.weekRules.contextOf(congregationId);
    const rulesCache = new Map<string, WeekRules>();
    const rulesOf = (week: string): WeekRules => {
      let r = rulesCache.get(week);
      if (!r) {
        r = this.weekRules.rulesFrom(ctx, week);
        rulesCache.set(week, r);
      }
      return r;
    };
    /** Where and when a meeting of a week is — or why it is not held. */
    const meetingOf = (week: string, kind: MeetingKind) => {
      const r = rulesOf(week);
      const date = r.dateOf(kind);
      const held = r.meetings.some((m) => m.kind === kind);
      let reason: NotHeldReason | null = null;
      if (!held) {
        reason = !date
          ? 'no_day'
          : r.congress
            ? 'congress'
            : r.memorialTakes === kind
              ? 'memorial'
              : r.replacedBy(kind)
                ? 'replaced'
                : 'no_day';
      }
      const start = r.timeOf(kind);
      return {
        date: date ?? week,
        start: held ? start : null,
        end: held && start ? plusMinutes(start, MEETING_MINUTES) : null,
        place: held ? r.placeOf(kind) : null,
        key: `${kind}:${date ?? week}`,
        reason,
      };
    };

    // ── Absences: «away» ─────────────────────────────────────────────────
    const absences = await this.ds.getRepository(Absence).find({
      where: { congregationId, publisherId: pid },
    });
    /**
     * Away that day — not counting the absence the item itself made: a talk
     * elsewhere marks its own day, and the school writes one absence per
     * helper and meeting day (so nobody is put on that evening's meeting) —
     * that one belongs to every school duty of the day, not to one of them
     * (8 November 2026, seen in the first real calendar).
     */
    const awayOn = (
      date: string,
      own?: { talkExchangeId?: string; school?: boolean },
    ) =>
      absences.some(
        (a) =>
          a.startDate <= date &&
          (a.endDate ?? a.startDate) >= date &&
          !(own?.talkExchangeId && a.talkExchangeId === own.talkExchangeId) &&
          !(own?.school && a.pioneerSchoolDutyId),
      );

    const base = (
      x: Partial<AgendaItem> &
        Pick<AgendaItem, 'id' | 'kind' | 'date' | 'title'>,
    ): AgendaItem => ({
      scope: 'mine',
      endDate: null,
      start: null,
      end: null,
      detail: null,
      meetingKey: null,
      meeting: null,
      asAssistant: false,
      with: [],
      place: null,
      mapUrl: null,
      state: 'ok',
      notHeldReason: null,
      eventType: null,
      ...x,
    });
    const push = (
      item: AgendaItem,
      own?: { talkExchangeId?: string; school?: boolean },
    ) => {
      if (
        !inSpan(item.date) &&
        !(item.endDate && item.endDate >= from && item.date <= to)
      ) {
        return;
      }
      if (
        item.scope === 'mine' &&
        item.state === 'ok' &&
        awayOn(item.date, own)
      ) {
        item.state = 'away';
      }
      items.push(item);
    };
    const names = async (ids: (string | null | undefined)[]) => {
      const want = [...new Set(ids.filter((x): x is string => !!x))];
      if (!withNames || want.length === 0) return new Map<string, string>();
      const cards = await this.ds.getRepository(Publisher).find({
        where: { congregationId, id: In(want) },
        withDeleted: true,
      });
      return new Map(cards.map((p) => [p.id, nameOf(p, opts.lastNameFirst)]));
    };

    // ── Programme parts (midweek and weekend) ────────────────────────────
    /** Order within one meeting, by item id (see partRank). */
    const rank = new Map<string, number>();
    const parts = await this.ds.getRepository(Assignment).find({
      where: [
        {
          congregationId,
          status: AssignmentStatus.PUBLISHED,
          weekStartDate: Between(firstWeek, to),
          publisherId: pid,
        },
        {
          congregationId,
          status: AssignmentStatus.PUBLISHED,
          weekStartDate: Between(firstWeek, to),
          assistantPublisherId: pid,
        },
      ],
      order: { weekStartDate: 'ASC', partOrder: 'ASC' },
    });
    const partners = await names(
      parts.map((a) =>
        a.assistantPublisherId === pid ? a.publisherId : a.assistantPublisherId,
      ),
    );
    for (const a of parts) {
      rank.set(
        `part:${a.id}${a.assistantPublisherId === pid ? ':assistant' : ''}`,
        partRank(String(a.partKey), a.partOrder),
      );
      const kind = String(a.eventType);
      if (kind !== 'midweek' && kind !== 'weekend') continue;
      const m = meetingOf(day(a.weekStartDate), kind);
      const asAssistant = a.assistantPublisherId === pid;
      const other = asAssistant ? a.publisherId : a.assistantPublisherId;
      const title = labelOf(
        {
          type: 'part',
          labelKey: a.partKey,
          labelTitle: a.partTitle,
          assistant: asAssistant,
          slot: null,
        },
        lang,
      );
      push(
        base({
          id: `part:${a.id}${asAssistant ? ':assistant' : ''}`,
          kind: 'part',
          date: m.date,
          start: m.start,
          end: m.end,
          title,
          // A chairman's or a prayer's line in the programme carries the
          // NEXT part along (seen in the first real calendar: the opening
          // prayer «· Иегова справедливо осудил…»): nothing to add for them.
          detail: NO_DETAIL.has(String(a.partKey))
            ? null
            : detailOf(a.partTitle, title),
          meetingKey: m.key,
          meeting: kind,
          asAssistant,
          with: other && partners.get(other) ? [partners.get(other)!] : [],
          place: m.place,
          state: m.reason ? 'not_held' : 'ok',
          notHeldReason: m.reason,
        }),
      );
    }

    // ── The Memorial: its own lines and duties, once its programme is out ─
    const memorials = (
      await this.ds.getRepository(SpecialEvent).find({
        where: { congregationId, type: 'memorial' },
      })
    ).filter((e) => !!e.memorialPublishedAt);
    const memorialByWeek = new Map(memorials.map((e) => [mondayOf(e.date), e]));
    if (memorials.length > 0) {
      const lines = await this.ds.getRepository(MemorialItem).find({
        where: {
          congregationId,
          specialEventId: In(memorials.map((e) => e.id)),
          publisherId: pid,
        },
        order: { sortOrder: 'ASC' },
      });
      const byId = new Map(memorials.map((e) => [e.id, e]));
      for (const line of lines) {
        const e = byId.get(line.specialEventId);
        if (!e) continue;
        const start = hhmm(e.time);
        push(
          base({
            id: `memorial_part:${line.id}`,
            kind: 'part',
            date: day(e.date),
            start,
            end: hhmm(e.timeEnd) ?? (start ? plusMinutes(start, 60) : null),
            title: line.label?.trim() || words.memorial,
            meetingKey: `memorial:${e.id}`,
            meeting: 'memorial',
            place: e.address?.trim() || null,
            mapUrl: e.mapUrl ?? null,
          }),
        );
      }
    }

    // ── Duties ───────────────────────────────────────────────────────────
    const duties = await this.ds.getRepository(Duty).find({
      where: {
        congregationId,
        publisherId: pid,
        weekStartDate: Between(firstWeek, to),
      },
    });
    // Whether a microphone is numbered depends on how many the meeting has.
    const micCounts = duties.length
      ? await this.ds
          .getRepository(Duty)
          .createQueryBuilder('d')
          .select('d.week_start_date', 'week')
          .addSelect('d.event_type', 'kind')
          .addSelect('COUNT(*)', 'n')
          .where('d.congregation_id = :congregationId', { congregationId })
          .andWhere("d.duty_type = 'microphone'")
          .andWhere('d.week_start_date BETWEEN :a AND :b', {
            a: firstWeek,
            b: to,
          })
          .groupBy('d.week_start_date')
          .addGroupBy('d.event_type')
          .getRawMany<{ week: string | Date; kind: string; n: string }>()
      : [];
    const mics = new Map(
      micCounts.map((r) => [`${day(r.week)}|${r.kind}`, Number(r.n)]),
    );
    for (const d of duties) {
      const kind = String(d.eventType);
      const type = String(d.dutyType);
      const week = day(d.weekStartDate);
      const slot =
        type === 'microphone' && (mics.get(`${week}|${kind}`) ?? 0) > 1
          ? d.slotIndex + 1
          : null;
      const title = labelOf(
        {
          type: 'duty',
          labelKey: type,
          labelTitle: d.customLabel,
          assistant: false,
          slot,
        },
        lang,
      );
      if (kind === 'memorial') {
        const e = memorialByWeek.get(week);
        if (!e) continue; // not out yet
        const start = hhmm(e.time);
        push(
          base({
            id: `duty:${d.id}`,
            kind: 'duty',
            date: day(e.date),
            start,
            end: hhmm(e.timeEnd) ?? (start ? plusMinutes(start, 60) : null),
            title,
            meetingKey: `memorial:${e.id}`,
            meeting: 'memorial',
            place: e.address?.trim() || null,
            mapUrl: e.mapUrl ?? null,
          }),
        );
        continue;
      }
      if (kind !== 'midweek' && kind !== 'weekend') continue;
      const m = meetingOf(week, kind);
      push(
        base({
          id: `duty:${d.id}`,
          kind: 'duty',
          date: m.date,
          start: m.start,
          end: m.end,
          title,
          meetingKey: m.key,
          meeting: kind,
          place: m.place,
          state: m.reason ? 'not_held' : 'ok',
          notHeldReason: m.reason,
        }),
      );
    }

    // ── Cleaning: after a meeting that is held; the thorough one on its day
    const tz = await this.clock.timezoneOf(congregationId);
    const cleanings = await this.ds.getRepository(CleaningAssignment).find({
      where: [
        ...(me.serviceGroupId
          ? [
              {
                congregationId,
                serviceGroupId: me.serviceGroupId,
                weekStartDate: Between(firstWeek, to),
              },
            ]
          : []),
        {
          congregationId,
          slotType: CleaningSlotType.GENERAL,
          weekStartDate: Between(firstWeek, to),
        },
      ],
    });
    for (const c of cleanings) {
      const week = day(c.weekStartDate);
      if (c.slotType === CleaningSlotType.AFTER_MEETING) {
        for (const kind of ['midweek', 'weekend'] as const) {
          const m = meetingOf(week, kind);
          // No meeting, nothing to clean after (7 November 2026).
          if (m.reason) continue;
          push(
            base({
              id: `cleaning:${c.id}:${kind}`,
              kind: 'cleaning',
              date: m.date,
              start: m.end,
              end: m.end ? plusMinutes(m.end, 30) : null,
              title: words.cleaningAfter,
              meetingKey: m.key,
              meeting: kind,
              place: m.place,
            }),
          );
        }
        continue;
      }
      // Thorough or general: only once a day is set for it.
      if (!c.thoroughPlannedAt) continue;
      const at = new Date(c.thoroughPlannedAt);
      const p = localDateParts(at, tz);
      const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      const min = minutesOfDayIn(at, tz);
      const start = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      push(
        base({
          id: `cleaning:${c.id}`,
          kind: 'cleaning',
          date,
          start,
          end: plusMinutes(start, 120),
          title:
            c.slotType === CleaningSlotType.GENERAL
              ? words.cleaningGeneral
              : words.cleaningThorough,
          place: rulesOf(mondayOf(date)).version?.address?.trim() || null,
        }),
      );
    }

    // ── Cart shifts: one per joined span, the called-off parts out ───────
    const cart = await this.ds
      .getRepository(CartAssignment)
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.day', 'd')
      .innerJoinAndSelect('d.week', 'w')
      .leftJoinAndSelect('d.location', 'loc')
      .where('a.congregation_id = :congregationId', { congregationId })
      .andWhere('a.publisher_id = :pid', { pid })
      .andWhere("w.status = 'published'")
      .andWhere('d.date BETWEEN :from AND :to', { from, to })
      .getMany();
    if (cart.length > 0) {
      const dayIds = [...new Set(cart.map((a) => a.dayId))];
      const all = await this.ds.getRepository(CartAssignment).find({
        where: { congregationId, dayId: In(dayIds) },
      });
      const offs: { day_id: string; start_time: string; end_time: string }[] =
        await this.ds.query(
          `SELECT day_id, start_time, end_time FROM cart_cancellations WHERE day_id = ANY($1::uuid[])`,
          [dayIds],
        );
      const people = await names(all.map((a) => a.publisherId));
      const span = (r: { startTime: string; endTime: string }) => ({
        startTime: String(r.startTime).slice(0, 5),
        endTime: String(r.endTime).slice(0, 5),
      });
      for (const dayId of dayIds) {
        const own = cart.filter((a) => a.dayId === dayId);
        const off = offs
          .filter((o) => o.day_id === dayId)
          .map((o) => span({ startTime: o.start_time, endTime: o.end_time }));
        const d = own[0].day;
        for (const s of cartMerge(
          own.flatMap((a) => cartMinus(span(a), off)),
        )) {
          const others = all
            .filter(
              (o) =>
                o.dayId === dayId &&
                o.publisherId !== pid &&
                cartOverlaps(span(o), s),
            )
            .map((o) =>
              o.publisherId
                ? (people.get(o.publisherId) ?? '')
                : withNames
                  ? (o.externalName ?? '').trim()
                  : '',
            )
            .filter(Boolean);
          push(
            base({
              id: `cart:${dayId}:${s.startTime}`,
              kind: 'cart',
              date: day(d.date),
              start: s.startTime,
              end: s.endTime,
              title: words.cart(d.location?.name?.trim() ?? ''),
              with: others,
              place: d.location?.name?.trim() || null,
            }),
          );
        }
      }
    }

    // ── Field service: the meetings he conducts, or goes to with the overseer
    const service = await this.ds.getRepository(FieldServiceMeeting).find({
      where: [
        {
          congregationId,
          publishedAt: Not(IsNull()),
          cancelledAt: IsNull(),
          weekStartDate: Between(firstWeek, to),
          conductorPublisherId: pid,
        },
        {
          congregationId,
          publishedAt: Not(IsNull()),
          cancelledAt: IsNull(),
          weekStartDate: Between(firstWeek, to),
          serviceOverseerVisit: true,
          serviceOverseerPublisherId: pid,
        },
        {
          congregationId,
          publishedAt: Not(IsNull()),
          cancelledAt: IsNull(),
          weekStartDate: Between(firstWeek, to),
          serviceOverseerVisit: true,
          serviceOverseerAssistantId: pid,
        },
      ],
    });
    const servicePeers = await names(
      service.map((f) =>
        f.serviceOverseerVisit
          ? f.serviceOverseerAssistantId === pid
            ? f.serviceOverseerPublisherId
            : f.serviceOverseerAssistantId
          : null,
      ),
    );
    for (const f of service) {
      const peer = f.serviceOverseerVisit
        ? f.serviceOverseerAssistantId === pid
          ? f.serviceOverseerPublisherId
          : f.serviceOverseerAssistantId
        : null;
      const conducts = f.conductorPublisherId === pid;
      push(
        base({
          id: `field_service:${f.id}`,
          kind: 'field_service',
          date: addDaysISO(day(f.weekStartDate), (f.dayOfWeek ?? 1) - 1),
          start: hhmm(f.startTime),
          end: f.startTime ? plusMinutes(hhmm(f.startTime)!, 60) : null,
          title:
            conducts && !f.serviceOverseerVisit
              ? words.fieldService
              : f.serviceOverseerVisit
                ? words.fieldServiceVisit
                : words.fieldService,
          detail: f.notice?.trim() || null,
          with: peer && servicePeers.get(peer) ? [servicePeers.get(peer)!] : [],
          place: f.address?.trim() || null,
        }),
      );
    }

    // ── Talks our brother gives elsewhere ────────────────────────────────
    const talks = await this.ds.getRepository(TalkExchange).find({
      where: {
        congregationId,
        direction: TalkExchangeDirection.OUTGOING,
        publisherId: pid,
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
        date: Between(from, to),
      },
    });
    if (talks.length > 0) {
      const hostIds = talks
        .map((t) => t.hostCongregationId)
        .filter((x): x is string => !!x);
      const hosts = hostIds.length
        ? await this.ds.getRepository(ExternalCongregation).find({
            where: { congregationId, id: In(hostIds) },
          })
        : [];
      const host = new Map(hosts.map((h) => [h.id, h]));
      const talkIds = talks
        .map((t) => t.publicTalkId)
        .filter((x): x is string => !!x);
      const outlines = talkIds.length
        ? await this.ds
            .getRepository(PublicTalk)
            .find({ where: { id: In(talkIds) } })
        : [];
      const outline = new Map(outlines.map((o) => [o.id, o]));
      for (const t of talks) {
        const h = t.hostCongregationId
          ? host.get(t.hostCongregationId)
          : undefined;
        const o = t.publicTalkId ? outline.get(t.publicTalkId) : undefined;
        const start = hhmm(h?.meetingTime);
        push(
          base({
            id: `outgoing_talk:${t.id}`,
            kind: 'outgoing_talk',
            date: day(t.date),
            start,
            end: start ? plusMinutes(start, MEETING_MINUTES) : null,
            title: words.outgoingTalk(h?.name?.trim() || null),
            detail: o
              ? `№${o.number}. ${o.title}`
              : t.specialTheme?.trim() || null,
            place: h?.address?.trim() || null,
            mapUrl: h?.mapUrl ?? null,
          }),
          { talkExchangeId: t.id },
        );
      }
    }

    // ── Lunch for a visiting speaker ─────────────────────────────────────
    const lunches = await this.ds.getRepository(TalkExchange).find({
      where: {
        congregationId,
        direction: TalkExchangeDirection.INCOMING,
        hospitalityPublisherId: pid,
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
        meetingCancelled: false,
        date: Between(from, to),
      },
    });
    for (const t of lunches) {
      push(
        base({
          id: `guest_lunch:${t.id}`,
          kind: 'guest_lunch',
          date: day(t.date),
          title: words.guestLunch,
        }),
      );
    }

    // ── The circuit overseer's visit: what is the person's own ───────────
    await this.coVisit(
      congregationId,
      me,
      today,
      from,
      to,
      words,
      base,
      push,
      (d) => rulesOf(mondayOf(d)).version?.address?.trim() || null,
    );

    // ── Pioneers' meeting ────────────────────────────────────────────────
    const pm = await this.ds.getRepository(PioneerMeeting).find({
      where: { congregationId, date: Between(from, to) },
    });
    if (pm.length > 0) {
      const spells = await this.ds.getRepository(PioneerSpell).find({
        where: { congregationId, publisherId: pid },
      });
      const conductors = await names(pm.flatMap((m) => conductorIdsOf(m)));
      for (const m of pm) {
        const d = day(m.date);
        // Up to two conduct it — a card or a name written by hand
        // (9 November 2026); those who conduct it are invited by doing so.
        const places = conductorsOf(m);
        const conducts = places.some((c) => c.publisherId === pid);
        if (!conducts && !invitedOn(spells, d).includes(pid)) continue;
        const nameOfPlace = (c: (typeof places)[number]) =>
          c.publisherId
            ? (conductors.get(c.publisherId) ?? '')
            : (c.name ?? '');
        push(
          base({
            id: `pioneer_meeting:${m.id}`,
            kind: 'pioneer_meeting',
            date: d,
            start: hhmm(m.timeStart),
            end: hhmm(m.timeEnd),
            title: conducts
              ? words.pioneerMeetingConduct
              : words.pioneerMeetingInvited,
            // A conductor: the other one; a pioneer: who conducts it.
            with: withNames
              ? places
                  .filter((c) => !conducts || c.publisherId !== pid)
                  .map(nameOfPlace)
                  .filter(Boolean)
              : [],
            place: m.place?.trim() || null,
          }),
        );
      }
    }

    // ── Pioneer school: his duties there ─────────────────────────────────
    const school = await this.ds
      .getRepository(PioneerSchoolDuty)
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.day', 'y')
      .innerJoinAndSelect('y.school', 's')
      .innerJoin('d.helper', 'h')
      .where('d.congregation_id = :congregationId', { congregationId })
      .andWhere('h.publisher_id = :pid', { pid })
      .andWhere('h.deleted_at IS NULL')
      .andWhere('s.deleted_at IS NULL')
      .andWhere('y.date BETWEEN :from AND :to', { from, to })
      .getMany();
    // One event per school day, every duty of the day in it: two duties
    // on one day read as two whole-day events side by side (8 November 2026).
    const schoolDays = new Map<string, typeof school>();
    for (const d of school) {
      const key = `${d.day.schoolId}|${day(d.day.date)}`;
      schoolDays.set(key, [...(schoolDays.get(key) ?? []), d]);
    }
    for (const [key, duties] of schoolDays) {
      const first = duties[0];
      const s = first.day.school;
      const names = duties
        .sort(
          (a, b) =>
            String(a.dutyType).localeCompare(String(b.dutyType)) ||
            a.slotIndex - b.slotIndex,
        )
        .map((d) => {
          const type = String(d.dutyType);
          const name =
            d.customLabel?.trim() ||
            DUTY_NAMES[lang][type] ||
            DUTY_NAMES[lang].custom;
          return type === 'microphone' && s.microphoneSlots > 1
            ? `${name} ${d.slotIndex + 1}`
            : name;
        });
      push(
        base({
          id: `pioneer_school:${key.replace('|', ':')}`,
          kind: 'pioneer_school',
          date: day(first.day.date),
          start: hhmm(first.day.startTime) ?? hhmm(s.startTime),
          end: hhmm(first.day.endTime) ?? hhmm(s.endTime),
          title: words.pioneerSchool([...new Set(names)].join(', ')),
          place:
            [s.hallName?.trim(), s.hallAddress?.trim()]
              .filter(Boolean)
              .join(', ') || null,
        }),
        { school: true },
      );
    }

    // ── Elders' meetings: date and place only, never the agenda ──────────
    if (me.appointment === PublisherAppointment.ELDER) {
      const meetings = await this.ds.getRepository(EldersMeeting).find({
        where: { congregationId, date: Between(from, to) },
      });
      const hallIds = meetings
        .map((m) => m.hallId)
        .filter((x): x is string => !!x);
      const halls = hallIds.length
        ? await this.ds
            .getRepository(Hall)
            .find({ where: { congregationId, id: In(hallIds) } })
        : [];
      const hall = new Map(halls.map((h) => [h.id, h]));
      for (const m of meetings) {
        const h = m.hallId ? hall.get(m.hallId) : undefined;
        push(
          base({
            id: `elders_meeting:${m.id}`,
            kind: 'elders_meeting',
            date: day(m.date),
            start: hhmm(m.startTime),
            end: null,
            title: words.eldersMeeting,
            place:
              m.placeText?.trim() ||
              (h
                ? [h.name?.trim(), h.address?.trim()].filter(Boolean).join(', ')
                : null) ||
              null,
          }),
        );
      }
    }

    // ── Events for the invited only: the person's own, if invited ─────────
    // (10 November 2026). In the calendar as his, whatever his choice about
    // big events — it is an invitation, not news of the congregation.
    {
      const invitations = await this.ds.getRepository(SpecialEvent).find({
        where: { congregationId, type: In(Object.keys(INVITE_ONLY_TYPES)) },
      });
      for (const e of invitations) {
        const who = inviteesOf(e.type);
        if (!who || !isInvited(me, who, day(e.date))) continue;
        const date = day(e.date);
        const endDate = e.endDate ? day(e.endDate) : null;
        const many = !!endDate && endDate !== date;
        push(
          base({
            id: `event:${e.id}`,
            kind: 'event',
            scope: 'mine',
            date,
            endDate: many ? endDate : null,
            start: hhmm(e.time),
            end: hhmm(e.timeEnd) ?? null,
            title: words.events[String(e.type)] ?? e.title,
            detail:
              e.title?.trim() && e.title.trim() !== words.events[String(e.type)]
                ? e.title.trim()
                : null,
            place: e.address?.trim() || null,
            mapUrl: e.mapUrl ?? null,
            eventType: String(e.type),
          }),
        );
      }
    }

    // ── Big events of the congregation ───────────────────────────────────
    const events = await this.ds.getRepository(SpecialEvent).find({
      where: { congregationId, type: In([...BIG_EVENT_TYPES]) },
    });
    for (const e of events) {
      // The circuit overseer staying with the person: the same visit, once —
      // as theirs, so it stays in their calendar even with big events
      // switched off (8 November 2026).
      const host =
        e.type === 'circuit_overseer_visit' &&
        e.coAccommodationPublisherId === pid;
      const date = day(e.date);
      const endDate = e.endDate ? day(e.endDate) : null;
      const many = !!endDate && endDate !== date;
      const start = many ? null : hhmm(e.time);
      push(
        base({
          id: `event:${e.id}`,
          kind: 'event',
          scope: host ? 'mine' : 'event',
          date,
          endDate: many ? endDate : null,
          start,
          end: many ? null : (hhmm(e.timeEnd) ?? null),
          title: host
            ? `${words.events.circuit_overseer_visit} — ${words.coAccommodation}`
            : (words.events[String(e.type)] ?? e.title),
          detail:
            e.title?.trim() && e.title.trim() !== words.events[String(e.type)]
              ? e.title.trim()
              : null,
          meetingKey: e.type === 'memorial' ? `memorial:${e.id}` : null,
          meeting: e.type === 'memorial' ? 'memorial' : null,
          place: e.address?.trim() || null,
          mapUrl: e.mapUrl ?? null,
          eventType: String(e.type),
        }),
      );
    }

    items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.start ?? '').localeCompare(b.start ?? '') ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) ||
        a.id.localeCompare(b.id),
    );
    return { publisherId: pid, from, to, items };
  }

  /** The visit's lines that are the person's — the same rule as the visit's own «mine» list. */
  private async coVisit(
    congregationId: string,
    me: Publisher,
    today: string,
    from: string,
    to: string,
    words: (typeof AGENDA_WORDS)[SupportedLanguage],
    base: (
      x: Partial<AgendaItem> &
        Pick<AgendaItem, 'id' | 'kind' | 'date' | 'title'>,
    ) => AgendaItem,
    push: (item: AgendaItem) => void,
    hallOn: (date: string) => string | null,
  ): Promise<void> {
    const visits = (
      await this.ds.getRepository(SpecialEvent).find({
        where: { congregationId, type: 'circuit_overseer_visit' },
      })
    ).filter((v) => (v.endDate ?? v.date) >= from && v.date <= to);
    if (visits.length === 0) return;
    const isPioneer =
      isActivePermanentPioneer(me.pioneerType, me.pioneerSince) ||
      (await this.auxPioneers.isActiveAuxiliaryPioneer(
        congregationId,
        me.id,
        today,
      ));
    const isAppointed =
      me.appointment === PublisherAppointment.ELDER ||
      me.appointment === PublisherAppointment.MINISTERIAL_SERVANT;
    const lines = await this.ds.getRepository(CoVisitItem).find({
      where: { congregationId, specialEventId: In(visits.map((v) => v.id)) },
      relations: { cartLocation: true },
    });
    const visitById = new Map(visits.map((v) => [v.id, v]));
    for (const it of lines) {
      if (it.kind === 'document_review') continue;
      if (it.forWife && it.kind !== 'field_service') continue;
      const mine = it.assigneePublisherId === me.id;
      if (
        !mine &&
        !(it.kind === 'pioneers' && isPioneer) &&
        !(it.kind === 'elders' && isAppointed)
      ) {
        continue;
      }
      if (!visitById.has(it.specialEventId)) continue;
      const title =
        {
          lunch: words.coLunch,
          lunch_box: words.coLunchBox,
          field_service: words.coFieldService,
          pastoral: words.coPastoral,
          pioneers: words.coPioneers,
          elders: words.coElders,
        }[it.kind] ?? words.coOther;
      // Where — only for what happens at a public place. A lunch is at
      // somebody's home and a shepherding call is AT somebody's: neither
      // address belongs in a phone's calendar (7 November 2026).
      const public_ =
        it.kind === 'pioneers' ||
        it.kind === 'elders' ||
        it.kind === 'field_service';
      const place = !public_
        ? null
        : it.placeKind === 'cart_location'
          ? it.cartLocation?.name?.trim() || null
          : it.placeKind === 'custom'
            ? it.placeText?.trim() || null
            : hallOn(day(it.itemDate));
      push(
        base({
          id: `co_visit:${it.id}`,
          kind: 'co_visit',
          date: day(it.itemDate),
          start: hhmm(it.startTime),
          end: null,
          title,
          place,
        }),
      );
    }
  }
}

/** What the programme's line adds to the name: the reading, the theme, the lesson. */
export function detailOf(
  partTitle: string | null | undefined,
  title: string,
): string | null {
  const t = partTitle?.trim();
  if (!t) return null;
  const i = t.indexOf(': ');
  // «Песня 43 и молитва | Вступительные слова (1 мин.)»: a prayer's line
  // carries the next part along; only its own piece belongs here.
  const rest = (i >= 0 ? t.slice(i + 2) : t).split(' | ')[0].trim();
  if (!rest || rest === title || title.startsWith(rest)) return null;
  return rest;
}
