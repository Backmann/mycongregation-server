import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { PairAgreement } from '../entities/pair-agreement.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { Duty } from '../entities/duty.entity';
import { Absence } from '../entities/absence.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';
import {
  WeekRulesContext,
  WeekRulesService,
} from '../common/week-rules.service';
import { addDaysISO, isoDowOf } from '../common/week-rules';
import { CongregationClock } from '../common/congregation-clock.service';
import { todayIn } from '../common/congregation-clock';
import { NotificationsService } from '../notifications/notifications.service';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import { refusal } from '../common/errors/refusal';
import type { RefusalCode } from '../common/errors/refusal';
import { labelOf } from '../assignment-reminders/digest';
import {
  HiddenOption,
  MeetingFact,
  PrepOption,
  prepOptions,
} from './pair-prep-options';
import { dayWords, momentWords, pairWords } from './pair-prep-words';

/** A pair's messages a day — a ceiling against an endless ping-pong. */
export const MESSAGES_A_DAY = 5;

export interface AgreementView {
  status: 'proposed' | 'agreed' | 'declined';
  kind: string;
  date: string | null;
  time: string | null;
  meeting: string | null;
  proposedByMe: boolean;
  proposedAt: Date;
  answeredAt: Date | null;
}

export interface PairPrepItem {
  assignmentId: string;
  meetingDate: string;
  partnerName: string;
  /** The partner can be told: an active login. Without one, no button. */
  partnerHasApp: boolean;
  /** Before the meeting's day: proposals can still be made and answered. */
  open: boolean;
  /** A new proposal was already started today — the next one tomorrow. */
  startedToday: boolean;
  agreement: AgreementView | null;
}

const mondayOf = (iso: string): string => addDaysISO(iso, 1 - isoDowOf(iso));
const nameOf = (p: Pick<Publisher, 'lastName' | 'firstName'>): string =>
  `${p.lastName} ${p.firstName}`.trim();

function refuse(
  status: number,
  code: RefusalCode,
  message: string,
): HttpException {
  return new HttpException(refusal(code, message), status);
}

/**
 * «Договориться о подготовке» (10 November 2026): the two people of a part
 * agree when they will prepare it, and the app tells each of them — without
 * a telephone number shown to anybody and without a word typed by anybody.
 *
 * Rules (agreed with Lionel on the mock-up):
 *   • one open proposal a pair; the other one answers it — «подходит», another
 *     time (a counter-proposal is an ANSWER), or «не получится»;
 *   • a NEW proposal once a day per pair; answers always, up to
 *     MESSAGES_A_DAY messages a day in all;
 *   • only before the meeting's day; only when the partner has a login;
 *   • the moments offered are the congregation's own (pair-prep-options.ts);
 *   • every message goes through the notification gateway: the reader's
 *     language, quiet hours, the «Мои назначения» switch;
 *   • deleted the day after the meeting, and when the pair changes.
 */
@Injectable()
export class PairPrepService {
  constructor(
    @InjectRepository(PairAgreement)
    private readonly rows: Repository<PairAgreement>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Duty)
    private readonly duties: Repository<Duty>,
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    @InjectRepository(CleaningAssignment)
    private readonly cleaning: Repository<CleaningAssignment>,
    @InjectRepository(FieldServiceMeeting)
    private readonly services: Repository<FieldServiceMeeting>,
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
    private readonly notifications: NotificationsService,
  ) {}

  // ── who and what ─────────────────────────────────────────────────────

  private async me(tenantId: string, userId: string): Promise<Publisher> {
    const card = await this.publishers.findOne({
      where: { congregationId: tenantId, userId },
    });
    if (!card) {
      throw refuse(
        HttpStatus.FORBIDDEN,
        'PAIR_PREP_NOT_YOURS',
        'Only the two people of the part can arrange its preparation.',
      );
    }
    return card;
  }

  /** The part's meeting: its day and hour, by the week's own rules. */
  private async meetingOf(
    tenantId: string,
    a: Pick<Assignment, 'weekStartDate' | 'eventType'>,
    ctx?: WeekRulesContext,
  ): Promise<MeetingFact | null> {
    const kind = String(a.eventType);
    if (kind !== 'midweek' && kind !== 'weekend') return null;
    // One context a request: Home asks for this on every visit, and loading
    // the settings and events once per part was a query per part for nothing.
    const rules = ctx
      ? this.weekRules.rulesFrom(ctx, a.weekStartDate)
      : await this.weekRules.forWeek(tenantId, a.weekStartDate);
    const date = rules.dateOf(kind);
    if (!date || !rules.meetings.some((m) => m.kind === kind)) return null;
    return { date, kind, time: rules.timeOf(kind), weekStart: a.weekStartDate };
  }

  private async load(tenantId: string, userId: string, assignmentId: string) {
    const me = await this.me(tenantId, userId);
    const a = await this.assignments.findOne({
      where: { id: assignmentId, congregationId: tenantId },
    });
    if (
      !a ||
      a.status !== AssignmentStatus.PUBLISHED ||
      !a.publisherId ||
      !a.assistantPublisherId ||
      (a.publisherId !== me.id && a.assistantPublisherId !== me.id)
    ) {
      throw refuse(
        HttpStatus.FORBIDDEN,
        'PAIR_PREP_NOT_YOURS',
        'Only the two people of the part can arrange its preparation.',
      );
    }
    const partnerId =
      a.publisherId === me.id ? a.assistantPublisherId : a.publisherId;
    const partner = await this.publishers.findOneOrFail({
      where: { id: partnerId },
    });
    const meeting = await this.meetingOf(tenantId, a);
    const today = await this.clock.todayFor(tenantId);
    if (!meeting) {
      throw refuse(
        HttpStatus.CONFLICT,
        'PAIR_PREP_CLOSED',
        'This meeting is not held.',
      );
    }
    return { me, a, partner, meeting, today };
  }

  private async userOf(card: Publisher): Promise<User | null> {
    if (!card.userId) return null;
    return this.users.findOne({
      where: { id: card.userId, isActive: true, deletedAt: IsNull() },
    });
  }

  /** The row of this part, unless the pair has changed since (then gone). */
  private async rowOf(a: Assignment): Promise<PairAgreement | null> {
    const row = await this.rows.findOne({ where: { assignmentId: a.id } });
    if (!row) return null;
    if (
      row.holderPublisherId !== a.publisherId ||
      row.assistantPublisherId !== a.assistantPublisherId
    ) {
      await this.rows.delete({ id: row.id });
      return null;
    }
    return row;
  }

  private view(row: PairAgreement, meId: string): AgreementView | null {
    if (row.status === 'cancelled') return null;
    return {
      status: row.status as AgreementView['status'],
      kind: row.optionKind,
      date: row.optionDate,
      time: row.optionTime,
      meeting: row.optionMeeting,
      proposedByMe: row.proposedByPublisherId === meId,
      proposedAt: row.proposedAt,
      answeredAt: row.answeredAt,
    };
  }

  // ── reading ──────────────────────────────────────────────────────────

  /** Every part of mine with a partner, from today on. */
  async mine(tenantId: string, userId: string): Promise<PairPrepItem[]> {
    const card = await this.publishers.findOne({
      where: { congregationId: tenantId, userId },
    });
    if (!card) return [];
    const today = await this.clock.todayFor(tenantId);
    await this.prune(tenantId, today);
    const from = mondayOf(today);
    const parts = await this.assignments.find({
      where: [
        {
          congregationId: tenantId,
          publisherId: card.id,
          assistantPublisherId: Not(IsNull()),
          status: AssignmentStatus.PUBLISHED,
        },
        {
          congregationId: tenantId,
          assistantPublisherId: card.id,
          status: AssignmentStatus.PUBLISHED,
        },
      ],
    });
    const items: PairPrepItem[] = [];
    const upcoming = parts.filter((p) => p.weekStartDate >= from);
    if (upcoming.length === 0) return [];
    const ctx = await this.weekRules.contextOf(tenantId);
    for (const a of upcoming) {
      if (!a.publisherId || !a.assistantPublisherId) continue;
      const meeting = await this.meetingOf(tenantId, a, ctx);
      if (!meeting || meeting.date < today) continue;
      const partnerId =
        a.publisherId === card.id ? a.assistantPublisherId : a.publisherId;
      const partner = await this.publishers.findOne({
        where: { id: partnerId },
      });
      if (!partner) continue;
      const row = await this.rowOf(a);
      items.push({
        assignmentId: a.id,
        meetingDate: meeting.date,
        partnerName: nameOf(partner),
        partnerHasApp: !!(await this.userOf(partner)),
        open: today < meeting.date,
        startedToday: row?.lastStartedOn === today,
        agreement: row ? this.view(row, card.id) : null,
      });
    }
    return items.sort((x, y) => (x.meetingDate < y.meetingDate ? -1 : 1));
  }

  /** The moments the two of them could prepare at, and what was left out. */
  async options(
    tenantId: string,
    userId: string,
    assignmentId: string,
  ): Promise<{ options: PrepOption[]; hidden: HiddenOption[] }> {
    const { me, partner, meeting, today } = await this.load(
      tenantId,
      userId,
      assignmentId,
    );
    return this.optionsFor(tenantId, me, partner, meeting, today);
  }

  private async optionsFor(
    tenantId: string,
    me: Publisher,
    partner: Publisher,
    part: MeetingFact,
    today: string,
  ) {
    const weeks: string[] = [];
    for (let w = mondayOf(today); w <= part.weekStart; w = addDaysISO(w, 7)) {
      weeks.push(w);
    }
    const meetings: MeetingFact[] = [];
    const ctx = await this.weekRules.contextOf(tenantId);
    for (const w of weeks) {
      const rules = this.weekRules.rulesFrom(ctx, w);
      for (const m of rules.meetings) {
        meetings.push({ ...m, time: rules.timeOf(m.kind), weekStart: w });
      }
    }
    const pair = [me.id, partner.id];
    const duties = weeks.length
      ? await this.duties.find({
          where: {
            congregationId: tenantId,
            weekStartDate: In(weeks),
            publisherId: In(pair),
          },
        })
      : [];
    const at = (d: Duty) => `${d.weekStartDate}|${String(d.eventType)}`;
    const groups = [me.serviceGroupId, partner.serviceGroupId].filter(
      (g): g is string => !!g,
    );
    const cleaning =
      weeks.length && groups.length
        ? await this.cleaning.find({
            where: {
              congregationId: tenantId,
              weekStartDate: In(weeks),
              slotType: CleaningSlotType.AFTER_MEETING,
              serviceGroupId: In(groups),
            },
          })
        : [];
    const away = await this.absences.find({
      where: { congregationId: tenantId, publisherId: In(pair) },
    });
    const fsm = weeks.length
      ? await this.services.find({
          where: {
            congregationId: tenantId,
            weekStartDate: In(weeks),
            publishedAt: Not(IsNull()),
            cancelledAt: IsNull(),
          },
        })
      : [];
    return prepOptions({
      today,
      nowMinutes: await this.clock.minutesOfDayFor(tenantId),
      part,
      meetings,
      services: fsm.map((s) => ({
        id: s.id,
        date: addDaysISO(s.weekStartDate, s.dayOfWeek - 1),
        time: s.startTime,
      })),
      myDuties: new Set(duties.filter((d) => d.publisherId === me.id).map(at)),
      partnerDuties: new Set(
        duties.filter((d) => d.publisherId === partner.id).map(at),
      ),
      cleaningWeeks: new Set(cleaning.map((c) => c.weekStartDate)),
      away: (date) =>
        away.some(
          (x) =>
            !x.deletedAt &&
            x.startDate <= date &&
            (x.endDate === null || x.endDate >= date),
        ),
    });
  }

  // ── writing ──────────────────────────────────────────────────────────

  async propose(
    tenantId: string,
    userId: string,
    assignmentId: string,
    key: string,
    retried = false,
  ): Promise<PairPrepItem> {
    const { me, a, partner, meeting, today } = await this.load(
      tenantId,
      userId,
      assignmentId,
    );
    if (today >= meeting.date) {
      throw refuse(
        HttpStatus.CONFLICT,
        'PAIR_PREP_CLOSED',
        'The meeting is today or has passed.',
      );
    }
    const partnerUser = await this.userOf(partner);
    if (!partnerUser) {
      throw refuse(
        HttpStatus.CONFLICT,
        'PAIR_PREP_NO_APP',
        'The partner does not use the app; arrange it in person.',
      );
    }
    const { options } = await this.optionsFor(
      tenantId,
      me,
      partner,
      meeting,
      today,
    );
    const chosen = options.find((o) => o.key === key);
    if (!chosen) {
      throw refuse(
        HttpStatus.CONFLICT,
        'PAIR_PREP_OPTION_GONE',
        'That moment is no longer offered.',
      );
    }
    const row = await this.rowOf(a);
    const open = row?.status === 'proposed';
    const counter = open && row!.proposedByPublisherId !== me.id;
    const change = open && row!.proposedByPublisherId === me.id;
    const starts = !counter && !change;
    if (starts && row?.lastStartedOn === today) {
      throw refuse(
        HttpStatus.TOO_MANY_REQUESTS,
        'PAIR_PREP_ONCE_A_DAY',
        'A new proposal can be made once a day.',
      );
    }
    const count = this.countToday(row, today);

    let saved: PairAgreement;
    try {
      saved = await this.rows.save({
        ...(row ?? {}),
        congregationId: tenantId,
        assignmentId: a.id,
        holderPublisherId: a.publisherId!,
        assistantPublisherId: a.assistantPublisherId!,
        proposedByPublisherId: me.id,
        optionKind: chosen.kind,
        optionDate: chosen.date,
        optionTime: chosen.time,
        optionMeeting: chosen.meeting,
        status: 'proposed',
        proposedAt: new Date(),
        answeredAt: null,
        meetingDate: meeting.date,
        lastStartedOn: starts ? today : row!.lastStartedOn,
        messagesOn: today,
        messagesCount: count + 1,
      });
    } catch (err: any) {
      // Both pressed «send» at the same moment, each seeing no proposal: the
      // second row meets the first in the unique index. Asked again, this
      // one now finds the partner's open proposal and becomes its answer.
      if (!row && err?.code === '23505' && !retried) {
        return this.propose(tenantId, userId, assignmentId, key, true);
      }
      throw err;
    }

    await this.tell(tenantId, partnerUser.id, a, meeting, saved, (lang) => {
      const w = pairWords(lang);
      const who = nameOf(me);
      if (chosen.kind === 'self') return w.proposesSelf(who);
      const m = momentWords(chosen, lang);
      return counter ? w.counter(who, m) : w.proposes(who, m);
    });
    return (await this.mine(tenantId, userId)).find(
      (i) => i.assignmentId === a.id,
    )!;
  }

  async answer(
    tenantId: string,
    userId: string,
    assignmentId: string,
    answer: 'agree' | 'decline',
  ): Promise<PairPrepItem> {
    const { me, a, partner, meeting, today } = await this.load(
      tenantId,
      userId,
      assignmentId,
    );
    const row = await this.rowOf(a);
    if (
      !row ||
      row.status !== 'proposed' ||
      row.proposedByPublisherId === me.id
    ) {
      throw refuse(
        HttpStatus.CONFLICT,
        'PAIR_PREP_NOTHING_TO_ANSWER',
        'There is no proposal waiting for your answer.',
      );
    }
    if (today >= meeting.date) {
      throw refuse(
        HttpStatus.CONFLICT,
        'PAIR_PREP_CLOSED',
        'The meeting is today or has passed.',
      );
    }
    const count = this.countToday(row, today);
    row.status = answer === 'agree' ? 'agreed' : 'declined';
    row.answeredAt = new Date();
    row.messagesOn = today;
    row.messagesCount = count + 1;
    const saved = await this.rows.save(row);
    const partnerUser = await this.userOf(partner);
    if (partnerUser) {
      await this.tell(tenantId, partnerUser.id, a, meeting, saved, (lang) => {
        const w = pairWords(lang);
        return answer === 'agree'
          ? w.agreed(nameOf(me), momentWords(this.momentOf(saved), lang))
          : w.declined(nameOf(me));
      });
    }
    return (await this.mine(tenantId, userId)).find(
      (i) => i.assignmentId === a.id,
    )!;
  }

  /** The proposer takes an unanswered proposal back. Said to nobody. */
  async cancel(
    tenantId: string,
    userId: string,
    assignmentId: string,
  ): Promise<PairPrepItem> {
    const { me, a } = await this.load(tenantId, userId, assignmentId);
    const row = await this.rowOf(a);
    if (
      !row ||
      row.status !== 'proposed' ||
      row.proposedByPublisherId !== me.id
    ) {
      throw refuse(
        HttpStatus.CONFLICT,
        'PAIR_PREP_NOTHING_TO_ANSWER',
        'There is no proposal of yours to take back.',
      );
    }
    // Kept as «cancelled», not deleted: deleting would also forget that a
    // proposal was started today, and propose–cancel–propose would get round
    // the once-a-day rule.
    row.status = 'cancelled';
    await this.rows.save(row);
    return (await this.mine(tenantId, userId)).find(
      (i) => i.assignmentId === a.id,
    )!;
  }

  private countToday(row: PairAgreement | null, today: string): number {
    const count = row && row.messagesOn === today ? row.messagesCount : 0;
    if (count >= MESSAGES_A_DAY) {
      throw refuse(
        HttpStatus.TOO_MANY_REQUESTS,
        'PAIR_PREP_TOO_MANY',
        'Enough messages for today; arrange it in person.',
      );
    }
    return count;
  }

  private momentOf(row: PairAgreement) {
    return {
      kind: row.optionKind,
      date: row.optionDate,
      time: row.optionTime,
      meeting: row.optionMeeting,
    };
  }

  private async tell(
    tenantId: string,
    userId: string,
    a: Assignment,
    meeting: MeetingFact,
    row: PairAgreement,
    body: (lang: SupportedLanguage) => string,
  ): Promise<void> {
    await this.notifications.notify({
      tenantId,
      userIds: [userId],
      kind: 'pair_prep',
      // Each message once: the pair's row, the day and its number that day.
      key: `pair-prep:${row.id}:${row.messagesOn}:${row.messagesCount}`,
      text: (lang) => ({
        title: `${this.partName(a, lang)} · ${dayWords(meeting.date, lang)}`,
        body: body(lang),
      }),
      data: { type: 'pair_prep', assignmentId: a.id },
    });
  }

  private partName(a: Assignment, lang: SupportedLanguage): string {
    return labelOf(
      {
        type: 'part',
        labelKey: a.partKey,
        labelTitle: a.partTitle,
        assistant: false,
        slot: null,
      },
      lang,
    );
  }

  // ── the evening and the end ──────────────────────────────────────────

  /** Rows whose meeting has passed are deleted — the day after it. */
  async prune(tenantId: string, today: string): Promise<void> {
    await this.rows.delete({
      congregationId: tenantId,
      meetingDate: LessThan(today),
    });
  }

  /**
   * What the evening digest adds, per person: tomorrow's agreed preparation,
   * and — once, the evening after it was made — a proposal still waiting for
   * this person's answer. No push of its own: one line in the digest.
   */
  async eveningLines(
    tenantId: string,
    today: string,
  ): Promise<Map<string, (lang: SupportedLanguage) => string[]>> {
    await this.prune(tenantId, today);
    const tz = await this.clock.timezoneOf(tenantId);
    const tomorrow = addDaysISO(today, 1);
    const yesterday = addDaysISO(today, -1);
    const rows = await this.rows.find({
      where: { congregationId: tenantId, status: In(['agreed', 'proposed']) },
    });
    const out = new Map<string, ((lang: SupportedLanguage) => string)[]>();
    const add = (userId: string, f: (lang: SupportedLanguage) => string) =>
      out.set(userId, [...(out.get(userId) ?? []), f]);
    for (const row of rows) {
      const a = await this.assignments.findOne({
        where: { id: row.assignmentId },
      });
      if (
        !a ||
        a.publisherId !== row.holderPublisherId ||
        a.assistantPublisherId !== row.assistantPublisherId
      ) {
        continue;
      }
      const cards = await this.publishers.find({
        where: { id: In([row.holderPublisherId, row.assistantPublisherId]) },
      });
      const part = (lang: SupportedLanguage) => this.partName(a, lang);
      if (
        row.status === 'agreed' &&
        row.optionKind !== 'self' &&
        row.optionDate === tomorrow
      ) {
        for (const c of cards) {
          const u = await this.userOf(c);
          if (!u) continue;
          add(u.id, (lang) =>
            pairWords(lang).tomorrow(
              part(lang),
              momentWords(this.momentOf(row), lang),
            ),
          );
        }
      }
      if (
        row.status === 'proposed' &&
        todayIn(row.proposedAt, tz) === yesterday
      ) {
        const proposer = cards.find((c) => c.id === row.proposedByPublisherId);
        const addressee = cards.find((c) => c.id !== row.proposedByPublisherId);
        const u = addressee ? await this.userOf(addressee) : null;
        if (u && proposer) {
          add(u.id, (lang) =>
            pairWords(lang).waiting(nameOf(proposer), part(lang)),
          );
        }
      }
    }
    return new Map(
      [...out].map(([userId, fs]) => [
        userId,
        (lang: SupportedLanguage) => fs.map((f) => f(lang)),
      ]),
    );
  }

  /** The title of the evening message when nothing else is said that night. */
  eveningTitle(lang: SupportedLanguage): string {
    return pairWords(lang).eveningTitle;
  }
}
