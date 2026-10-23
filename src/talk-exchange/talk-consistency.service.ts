import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Between, In, Not, Repository } from 'typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { Congregation } from '../entities/congregation.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { UserRole } from '../common/enums/user-role.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import { SupportedLanguage } from '../common/i18n/supported-languages';
import { shortDay } from '../assignment-reminders/digest';
import { addDaysISO } from '../common/week-rules';
import { mondayOf } from '../common/week';
import { TALK_ATTENTION_KIND } from './talk-attention.service';

const PUBLIC_TALK_PART_KEY = 'public_talk_speaker';
/** How far ahead the weeks are compared: half a year of planning. */
const WEEKS_AHEAD = 26;

/** Why a week's journal and programme do not say the same. */
export type MismatchKind =
  | 'other_speaker'
  | 'no_entry'
  | 'empty_line'
  | 'cancel_unmarked';

export interface Mismatch {
  weekStartDate: string;
  kind: MismatchKind;
  /** The weekend day, for the words. */
  day: string;
  programme: string | null;
  journal: string | null;
}

const STR: Record<
  SupportedLanguage,
  {
    title: (n: number) => string;
    other_speaker: (day: string, p: string, j: string) => string;
    no_entry: (day: string, p: string) => string;
    empty_line: (day: string, j: string) => string;
    cancel_unmarked: (day: string, j: string) => string;
    more: (n: number) => string;
  }
> = {
  ru: {
    title: (n) =>
      n === 1
        ? 'Журнал и программа расходятся на одной неделе'
        : `Журнал и программа расходятся: недель — ${n}`,
    other_speaker: (d, p, j) => `${d}: в программе ${p}, в журнале ${j}`,
    no_entry: (d, p) => `${d}: в программе ${p}, в журнале записи нет`,
    empty_line: (d, j) => `${d}: в журнале ${j}, в программе никого`,
    cancel_unmarked: (d, j) =>
      `${d}: встреча отменена, а запись ${j} не помечена`,
    more: (n) => `и ещё ${n}`,
  },
  de: {
    title: (n) =>
      n === 1
        ? 'Vortragsplan und Programm weichen in einer Woche ab'
        : `Vortragsplan und Programm weichen ab: ${n} Wochen`,
    other_speaker: (d, p, j) => `${d}: im Programm ${p}, im Vortragsplan ${j}`,
    no_entry: (d, p) => `${d}: im Programm ${p}, im Vortragsplan kein Eintrag`,
    empty_line: (d, j) => `${d}: im Vortragsplan ${j}, im Programm niemand`,
    cancel_unmarked: (d, j) =>
      `${d}: Zusammenkunft abgesagt, Eintrag ${j} nicht markiert`,
    more: (n) => `und ${n} weitere`,
  },
  en: {
    title: (n) =>
      n === 1
        ? 'The talk log and the program differ in one week'
        : `The talk log and the program differ: ${n} weeks`,
    other_speaker: (d, p, j) => `${d}: the program has ${p}, the log ${j}`,
    no_entry: (d, p) => `${d}: the program has ${p}, the log has no entry`,
    empty_line: (d, j) => `${d}: the log has ${j}, the program nobody`,
    cancel_unmarked: (d, j) => `${d}: meeting canceled, entry ${j} not marked`,
    more: (n) => `and ${n} more`,
  },
};

/**
 * Every morning: do the journal «К нам» and the weekend programme still say
 * the same for the weeks ahead? (Lionel, 23 October 2026: «я как человек могу
 * ошибаться» — and so can the code.)
 *
 * The journal owns who speaks and the programme line shows it; nothing should
 * make them differ any more. That is exactly why it is checked: a new path
 * that brings them apart again is found the next morning by the
 * administrators, not on Sunday by the chairman reading out a name.
 *
 * One notice per distinct set of findings: the same differences are not
 * repeated every morning, a change in them is told again.
 */
@Injectable()
export class TalkConsistencyService {
  private readonly logger = new Logger(TalkConsistencyService.name);

  constructor(
    @InjectRepository(TalkExchange)
    private readonly entries: Repository<TalkExchange>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(VisitingSpeaker)
    private readonly speakers: Repository<VisitingSpeaker>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly notifications: NotificationsService,
    private readonly clock: CongregationClock,
  ) {}

  async runDaily(): Promise<void> {
    const all = await this.congregations.find({ select: { id: true } });
    for (const c of all) {
      try {
        await this.runFor(c.id);
      } catch (err) {
        this.logger.error(`talk consistency ${c.id}: ${String(err)}`);
      }
    }
  }

  /** The differences of the weeks ahead, and the notice if there are any. */
  async runFor(tenantId: string): Promise<Mismatch[]> {
    const found = await this.mismatches(tenantId);
    if (found.length === 0) return found;
    const admins = await this.users.find({
      where: { congregationId: tenantId, role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    if (admins.length === 0) return found;
    const digest = createHash('sha1')
      .update(
        found
          .map(
            (m) => `${m.weekStartDate}|${m.kind}|${m.programme}|${m.journal}`,
          )
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 16);
    const first = found[0];
    await this.notifications.notify({
      tenantId,
      userIds: admins.map((u) => u.id),
      kind: TALK_ATTENTION_KIND,
      key: `talk-consistency:${tenantId}:${digest}`,
      text: (l) => {
        const lines = found.slice(0, 3).map((m) => {
          const d = shortDay(m.day, l);
          const p = m.programme ?? '—';
          const j = m.journal ?? '—';
          return m.kind === 'other_speaker'
            ? STR[l].other_speaker(d, p, j)
            : m.kind === 'no_entry'
              ? STR[l].no_entry(d, p)
              : m.kind === 'empty_line'
                ? STR[l].empty_line(d, j)
                : STR[l].cancel_unmarked(d, j);
        });
        if (found.length > 3) lines.push(STR[l].more(found.length - 3));
        return { title: STR[l].title(found.length), body: lines.join('\n') };
      },
      data: {
        type: 'talk_exchange_attention',
        entryId: null,
        date: first.day,
      },
    });
    return found;
  }

  /**
   * The weeks ahead whose journal and programme disagree. Only weeks that
   * have a weekend programme are compared: a week without one is not yet
   * planned, and its entry is waiting for it, not wrong.
   */
  async mismatches(tenantId: string): Promise<Mismatch[]> {
    const today = await this.clock.todayFor(tenantId);
    const from = mondayOf(today);
    const to = addDaysISO(from, 7 * WEEKS_AHEAD);
    const lines = await this.assignments.find({
      where: {
        congregationId: tenantId,
        partKey: PUBLIC_TALK_PART_KEY,
        weekStartDate: Between(from, to),
      },
      order: { weekStartDate: 'ASC' },
    });
    if (lines.length === 0) return [];
    const live = await this.entries.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(from, addDaysISO(to, 6)),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });
    const byWeek = new Map(live.map((e) => [mondayOf(String(e.date)), e]));
    const cardIds = [
      ...new Set(
        [
          ...live.map((e) => e.visitingSpeakerId),
          ...lines.map((l) => l.visitingSpeakerId),
        ].filter((x): x is string => !!x),
      ),
    ];
    const cards = cardIds.length
      ? await this.speakers.find({
          where: { id: In(cardIds), congregationId: tenantId },
          withDeleted: true,
        })
      : [];
    const cardName = new Map(
      cards.map((c) => [
        c.id,
        [c.firstName, c.lastName].filter(Boolean).join(' '),
      ]),
    );
    const pubIds = [
      ...new Set(
        [
          ...live.map((e) => e.publisherId),
          ...lines.map((l) => l.publisherId),
        ].filter((x): x is string => !!x),
      ),
    ];
    const pubs = pubIds.length
      ? await this.publishers.find({
          where: { id: In(pubIds), congregationId: tenantId },
          withDeleted: true,
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const pubName = new Map(
      pubs.map((p) => [
        p.id,
        [p.firstName, p.lastName].filter(Boolean).join(' '),
      ]),
    );
    const norm = (s: string | null | undefined) =>
      (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

    const out: Mismatch[] = [];
    for (const line of lines) {
      const e = byWeek.get(line.weekStartDate) ?? null;
      const day = e
        ? String(e.date).slice(0, 10)
        : addDaysISO(line.weekStartDate, 6);
      const lineWho = line.publisherId
        ? (pubName.get(line.publisherId) ?? null)
        : line.speakerName?.trim() || null;
      const entryWho = !e
        ? null
        : e.publisherId
          ? (pubName.get(e.publisherId) ?? null)
          : ((e.visitingSpeakerId ? cardName.get(e.visitingSpeakerId) : null) ??
            (e.speakerName?.trim() || null));
      const lineHas = !!line.publisherId || !!line.speakerName?.trim();

      if (line.status === AssignmentStatus.CANCELLED) {
        if (e && !e.meetingCancelled) {
          out.push({
            weekStartDate: line.weekStartDate,
            kind: 'cancel_unmarked',
            day,
            programme: null,
            journal: entryWho,
          });
        }
        continue;
      }
      if (!e) {
        if (lineHas) {
          out.push({
            weekStartDate: line.weekStartDate,
            kind: 'no_entry',
            day,
            programme: lineWho,
            journal: null,
          });
        }
        continue;
      }
      if (e.meetingCancelled) continue;
      if (!lineHas) {
        // An entry with no speaker yet — a talk booked before the brother —
        // is not a difference.
        if (entryWho) {
          out.push({
            weekStartDate: line.weekStartDate,
            kind: 'empty_line',
            day,
            programme: null,
            journal: entryWho,
          });
        }
        continue;
      }
      // The circuit overseer's name stands over a brother of ours put there
      // before his visit: the programme then names the overseer.
      const sameBrother =
        !!line.publisherId && line.publisherId === e.publisherId;
      const sameGuest =
        !e.publisherId &&
        ((!!e.visitingSpeakerId &&
          line.visitingSpeakerId === e.visitingSpeakerId) ||
          norm(line.speakerName) === norm(e.speakerName) ||
          norm(line.speakerName) === norm(entryWho));
      if (!sameBrother && !sameGuest) {
        out.push({
          weekStartDate: line.weekStartDate,
          kind: 'other_speaker',
          day,
          programme: line.speakerName?.trim() || lineWho,
          journal: entryWho,
        });
      }
    }
    return out;
  }
}
