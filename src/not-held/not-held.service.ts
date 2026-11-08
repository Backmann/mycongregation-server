import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentNotice } from '../entities/assignment-notice.entity';
import { Congregation } from '../entities/congregation.entity';
import { Duty } from '../entities/duty.entity';
import {
  ClearedDuty,
  ClearedPart,
  NotHeldClearance,
} from '../entities/not-held-clearance.entity';
import { NotHeldAlert } from '../entities/not-held-alert.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { User } from '../entities/user.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { EventType } from '../common/enums/event-type.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { refusal } from '../common/errors/refusal';
import { EVENT_TYPE_RESPONSIBILITY } from '../common/guards/assignment-section.guard';
import {
  coerceLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { CongregationClock } from '../common/congregation-clock.service';
import { mondayOf } from '../common/week';
import { addDaysISO, MeetingKind, WeekRules } from '../common/week-rules';
import { WeekRulesService } from '../common/week-rules.service';
import { labelOf } from '../assignment-reminders/digest';
import { AssignmentsService } from '../assignments/assignments.service';
import { ProgrammeFreezeService } from '../assignments/programme-freeze.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LocalNeedsService } from '../local-needs/local-needs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/** The public talk's line: a guest speaker's journal entry hangs on it. */
const PUBLIC_TALK = 'public_talk_speaker';
/** How far ahead the screen and the notice look. */
const AHEAD_DAYS = 365;

export type NotHeldReason = 'congress' | 'memorial' | 'replaced';

export interface NotHeldPart {
  id: string;
  partKey: string;
  label: string;
  people: string[];
  /** A guest speaker from another congregation: «name · congregation». */
  guest: string | null;
}

export interface NotHeldDuty {
  id: string;
  dutyType: string;
  label: string;
  person: string | null;
}

/** One meeting that is not held, with what still stands on it. */
export interface NotHeldMeeting {
  weekStartDate: string;
  eventType: MeetingKind;
  /** Its usual day. */
  date: string | null;
  reason: NotHeldReason;
  event: {
    id: string;
    type: string;
    title: string;
    date: string;
    endDate: string | null;
  } | null;
  parts: NotHeldPart[];
  duties: NotHeldDuty[];
  /** Whether the reader may take off the parts / the duties. */
  canParts: boolean;
  canDuties: boolean;
}

/** What was taken off and may be put back. */
export interface NotHeldRestorable {
  clearanceId: string;
  weekStartDate: string;
  eventType: MeetingKind;
  clearedAt: string;
  parts: number;
  duties: number;
  /** The meeting is held again (the event moved): the offer to give back. */
  heldAgain: boolean;
}

export interface NotHeldView {
  meetings: NotHeldMeeting[];
  restorable: NotHeldRestorable[];
}

/** Who may do what: the programme's own rule (assignment-section.guard.ts). */
interface Rights {
  midweek: boolean;
  weekend: boolean;
  duties: boolean;
}

const WORDS: Record<
  SupportedLanguage,
  {
    title: (what: string, n: number) => string;
    body: (day: string) => string;
    againTitle: (day: string) => string;
    againBody: (n: number) => string;
  }
> = {
  ru: {
    title: (w, n) =>
      `${w}: ${n} ${plural('ru', n, 'назначение', 'назначения', 'назначений')} без встречи`,
    body: (d) =>
      `Встреча ${d} не проводится. Откройте неделю, чтобы снять назначения — людям об этом не сообщается.`,
    againTitle: (d) => `Встреча ${d} снова проводится`,
    againBody: (n) =>
      `Снятые назначения (${n}) можно вернуть на неделе — людям придёт обычное уведомление о назначении.`,
  },
  en: {
    title: (w, n) =>
      `${w}: ${n} ${n === 1 ? 'assignment' : 'assignments'} without a meeting`,
    body: (d) =>
      `The meeting on ${d} is not held. Open the week to take the assignments off — people are not notified.`,
    againTitle: (d) => `The meeting on ${d} is held again`,
    againBody: (n) =>
      `The assignments taken off (${n}) can be given back in the week — people get the usual assignment notice.`,
  },
  de: {
    title: (w, n) =>
      `${w}: ${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'} ohne Zusammenkunft`,
    body: (d) =>
      `Die Zusammenkunft am ${d} findet nicht statt. Öffnen Sie die Woche, um die Aufgaben zu entfernen — die Betroffenen werden nicht benachrichtigt.`,
    againTitle: (d) => `Die Zusammenkunft am ${d} findet wieder statt`,
    againBody: (n) =>
      `Die entfernten Aufgaben (${n}) können Sie in der Woche zurückholen — die Betroffenen erhalten die übliche Benachrichtigung.`,
  },
};

/**
 * Assignments on a meeting that is not held (8 November 2026).
 *
 * A convention, the Memorial, an event «no meeting that day» take a meeting
 * away; its parts and duties stay in the programme. Nobody is reminded of
 * them and everyone sees «встреча не проводится» — but the programme is not
 * clean, a guest speaker booked for that Sunday is never told, and the
 * screen that keeps the week hides the meeting, so they could not even be
 * seen. This service finds them by the week rules (the same ones the
 * reminders, «Мои назначения» and the calendar use), takes them off quietly,
 * gives them back if the event moves, and tells the person who keeps the
 * programme once.
 */
@Injectable()
export class NotHeldService {
  private readonly logger = new Logger(NotHeldService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Duty)
    private readonly duties: Repository<Duty>,
    @InjectRepository(AssignmentNotice)
    private readonly notices: Repository<AssignmentNotice>,
    @InjectRepository(NotHeldClearance)
    private readonly clearances: Repository<NotHeldClearance>,
    @InjectRepository(NotHeldAlert)
    private readonly alerts: Repository<NotHeldAlert>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
    private readonly freeze: ProgrammeFreezeService,
    private readonly assignmentsService: AssignmentsService,
    private readonly talkExchange: TalkExchangeService,
    private readonly localNeeds: LocalNeedsService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Rights ────────────────────────────────────────────────────────────

  async rightsOf(user: AuthenticatedUser): Promise<Rights> {
    if (user.role === UserRole.ADMIN) {
      return { midweek: true, weekend: true, duties: true };
    }
    const held = new Set(
      (
        await this.responsibilities.find({
          where: { congregationId: user.congregationId, userId: user.id },
          select: { type: true },
        })
      ).map((r) => r.type),
    );
    const any = (types: ResponsibilityType[]) => types.some((t) => held.has(t));
    return {
      midweek: any(EVENT_TYPE_RESPONSIBILITY[EventType.MIDWEEK]),
      weekend: any(EVENT_TYPE_RESPONSIBILITY[EventType.WEEKEND]),
      duties: any(EVENT_TYPE_RESPONSIBILITY[EventType.AV_DUTY]),
    };
  }

  // ── Finding them ──────────────────────────────────────────────────────

  /** Why a meeting of a week is not held — or null when it is held (or has no day at all). */
  static reasonOf(rules: WeekRules, kind: MeetingKind): NotHeldReason | null {
    if (rules.meetings.some((m) => m.kind === kind)) return null;
    if (!rules.dateOf(kind)) return null; // no meeting day on record: nothing to say
    if (rules.congress) return 'congress';
    if (rules.memorialTakes === kind) return 'memorial';
    if (rules.replacedBy(kind)) return 'replaced';
    return null;
  }

  /**
   * Every meeting from this week on that is not held and still has parts or
   * duties on it. Without `lang`, labels and names are not filled (the notice
   * needs only the numbers).
   */
  async find(
    congregationId: string,
    lang: SupportedLanguage | null,
  ): Promise<NotHeldMeeting[]> {
    const today = await this.clock.todayFor(congregationId);
    const first = mondayOf(today);
    const last = addDaysISO(today, AHEAD_DAYS);
    const ctx = await this.weekRules.contextOf(congregationId);
    const out: NotHeldMeeting[] = [];
    const candidates: {
      week: string;
      kind: MeetingKind;
      rules: WeekRules;
      reason: NotHeldReason;
    }[] = [];
    for (let w = first; w <= last; w = addDaysISO(w, 7)) {
      const rules = this.weekRules.rulesFrom(ctx, w);
      for (const kind of ['midweek', 'weekend'] as const) {
        const reason = NotHeldService.reasonOf(rules, kind);
        if (reason) candidates.push({ week: w, kind, rules, reason });
      }
    }
    if (candidates.length === 0) return out;
    const weeks = [...new Set(candidates.map((c) => c.week))];
    const parts = await this.assignments.find({
      where: {
        congregationId,
        weekStartDate: In(weeks),
        status: Not(AssignmentStatus.CANCELLED),
      },
      order: { partOrder: 'ASC' },
    });
    const duties = await this.duties.find({
      where: { congregationId, weekStartDate: In(weeks) },
      order: { sortOrder: 'ASC', slotIndex: 'ASC' },
    });
    const names = lang
      ? await this.namesOf(congregationId, [
          ...parts.flatMap((p) => [p.publisherId, p.assistantPublisherId]),
          ...duties.map((d) => d.publisherId),
        ])
      : new Map<string, string>();
    const eventsOfWeek = new Map<string, SpecialEvent[]>();
    for (const c of candidates) {
      const p = parts.filter(
        (a) =>
          day(a.weekStartDate) === c.week &&
          String(a.eventType) === c.kind &&
          hasPerson(a),
      );
      const d = duties.filter(
        (x) =>
          day(x.weekStartDate) === c.week && String(x.eventType) === c.kind,
      );
      if (p.length === 0 && d.length === 0) continue;
      // Earlier this week and already past: frozen, nothing to take off.
      const lock = await this.freeze.lockOf(congregationId, {
        weekStartDate: c.week,
        eventType: c.kind as unknown as EventType,
      });
      if (lock.held) continue;
      if (!eventsOfWeek.has(c.week)) {
        eventsOfWeek.set(
          c.week,
          await this.events
            .find({
              where: {
                congregationId,
                date: LessThanOrEqual(addDaysISO(c.week, 6)),
              },
            })
            .then((all) =>
              all.filter((e) => day(e.endDate ?? e.date) >= c.week),
            ),
        );
      }
      const evs = eventsOfWeek.get(c.week)!;
      const ev =
        c.reason === 'congress'
          ? evs.find((e) =>
              ['regional_convention', 'circuit_assembly'].includes(
                String(e.type),
              ),
            )
          : c.reason === 'memorial'
            ? evs.find((e) => e.type === 'memorial')
            : evs.find((e) => e.replacesMeeting);
      out.push({
        weekStartDate: c.week,
        eventType: c.kind,
        date: c.rules.dateOf(c.kind),
        reason: c.reason,
        event: ev
          ? {
              id: ev.id,
              type: String(ev.type),
              title: ev.title,
              date: day(ev.date),
              endDate: ev.endDate ? day(ev.endDate) : null,
            }
          : null,
        parts: p.map((a) => ({
          id: a.id,
          partKey: a.partKey,
          label: lang
            ? labelOf(
                {
                  type: 'part',
                  labelKey: a.partKey,
                  labelTitle: a.partTitle,
                  assistant: false,
                  slot: null,
                },
                lang,
              )
            : a.partKey,
          people: [a.publisherId, a.assistantPublisherId]
            .map((id) => (id ? names.get(id) : undefined))
            .filter((x): x is string => !!x),
          guest:
            a.partKey === PUBLIC_TALK && !a.publisherId && a.speakerName
              ? [a.speakerName, a.speakerCongregation]
                  .filter(Boolean)
                  .join(' · ')
              : null,
        })),
        duties: d.map((x) => ({
          id: x.id,
          dutyType: String(x.dutyType),
          label: lang
            ? labelOf(
                {
                  type: 'duty',
                  labelKey: String(x.dutyType),
                  labelTitle: x.customLabel,
                  assistant: false,
                  slot:
                    String(x.dutyType) === 'microphone'
                      ? x.slotIndex + 1
                      : null,
                },
                lang,
              )
            : String(x.dutyType),
          person: x.publisherId ? (names.get(x.publisherId) ?? null) : null,
        })),
        canParts: false,
        canDuties: false,
      });
    }
    return out;
  }

  /** The reader's view: only what they may act on, and what they may give back. */
  async view(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<NotHeldView> {
    const rights = await this.rightsOf(user);
    if (!rights.midweek && !rights.weekend && !rights.duties) {
      return { meetings: [], restorable: [] };
    }
    const me = await this.users.findOne({
      where: { id: user.id },
      select: { id: true, uiLanguage: true },
    });
    const lang = coerceLanguage(me?.uiLanguage);
    const meetings = (await this.find(congregationId, lang))
      .map((m) => {
        const canParts = rights[m.eventType];
        const canDuties = rights.duties;
        return {
          ...m,
          parts: canParts ? m.parts : [],
          duties: canDuties ? m.duties : [],
          canParts,
          canDuties,
        };
      })
      .filter((m) => m.parts.length + m.duties.length > 0);
    return {
      meetings,
      restorable: await this.restorable(congregationId, rights),
    };
  }

  private async restorable(
    congregationId: string,
    rights: Rights,
  ): Promise<NotHeldRestorable[]> {
    const today = await this.clock.todayFor(congregationId);
    const rows = await this.clearances.find({
      where: {
        congregationId,
        restoredAt: IsNull(),
        weekStartDate: MoreThanOrEqual(mondayOf(today)),
      },
      order: { weekStartDate: 'ASC', clearedAt: 'DESC' },
    });
    if (rows.length === 0) return [];
    const ctx = await this.weekRules.contextOf(congregationId);
    return rows
      .filter(
        (r) =>
          (r.parts.length === 0 || rights[r.eventType as MeetingKind]) &&
          (r.duties.length === 0 || rights.duties),
      )
      .map((r) => ({
        clearanceId: r.id,
        weekStartDate: day(r.weekStartDate),
        eventType: r.eventType as MeetingKind,
        clearedAt: r.clearedAt.toISOString(),
        parts: r.parts.length,
        duties: r.duties.length,
        heldAgain:
          NotHeldService.reasonOf(
            this.weekRules.rulesFrom(ctx, day(r.weekStartDate)),
            r.eventType as MeetingKind,
          ) === null,
      }));
  }

  // ── Taking them off ───────────────────────────────────────────────────

  /**
   * Takes off what stands on one meeting that is not held: its parts become
   * «cancelled» (the programme's own state for a part not given — it tells
   * the talk coordinator about a guest and comes back with the meeting), its
   * duties are removed and kept in the clearance. Quietly: the marks of what
   * people were told are dropped with them, so no evening note says «отменено»
   * about a meeting they already know is not held.
   */
  async clear(
    congregationId: string,
    user: AuthenticatedUser,
    input: {
      weekStartDate: string;
      eventType: MeetingKind;
      parts: boolean;
      duties: boolean;
    },
  ): Promise<{ clearanceId: string; parts: number; duties: number }> {
    const week = mondayOf(input.weekStartDate);
    const kind = input.eventType;
    const rights = await this.rightsOf(user);
    if (input.parts && !rights[kind])
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Not your meeting', {
          responsibilities:
            EVENT_TYPE_RESPONSIBILITY[kind as unknown as EventType],
        }),
      );
    if (input.duties && !rights.duties)
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Not your duties', {
          responsibilities: EVENT_TYPE_RESPONSIBILITY[EventType.AV_DUTY],
        }),
      );
    if (!input.parts && !input.duties)
      throw new ConflictException(
        refusal('NOT_HELD_NOTHING_CHOSEN', 'Nothing to take off'),
      );
    const rules = await this.weekRules.forWeek(congregationId, week);
    const reason = NotHeldService.reasonOf(rules, kind);
    if (!reason)
      throw new ConflictException(
        refusal('NOT_HELD_MEETING_HELD', 'This meeting is held'),
      );
    const lock = await this.freeze.lockOf(congregationId, {
      weekStartDate: week,
      eventType: kind as unknown as EventType,
    });
    if (lock.held)
      throw new ConflictException(
        refusal('NOT_HELD_PAST', 'This meeting is already past'),
      );

    // One transaction, the rows locked: two people pressing at once, or one
    // pressing twice, take off once — the second finds nothing left and is
    // told so, instead of a record «0 taken off» that would offer «Вернуть 0».
    // A failure half way leaves nothing half done.
    const { row, cleared, keptDuties, talk, partIds } =
      await this.clearances.manager.transaction(async (em) => {
        const cleared: ClearedPart[] = [];
        let talk = false;
        let partIds: string[] = [];
        if (input.parts) {
          const rows = (
            await em.getRepository(Assignment).find({
              where: {
                congregationId,
                weekStartDate: week,
                eventType: kind as unknown as EventType,
                status: Not(AssignmentStatus.CANCELLED),
              },
              lock: { mode: 'pessimistic_write' },
            })
          )
            // Only lines that name somebody: a song is no one's assignment.
            .filter(hasPerson);
          for (const a of rows) {
            cleared.push({ id: a.id, status: a.status });
            if (a.partKey === PUBLIC_TALK) talk = true;
          }
          partIds = rows.map((a) => a.id);
          if (rows.length) {
            await em.getRepository(Assignment).update(
              { congregationId, id: In(partIds) },
              {
                status: AssignmentStatus.CANCELLED,
                changedSincePublish: false,
              },
            );
            await em.getRepository(AssignmentNotice).delete({
              congregationId,
              itemType: 'part',
              itemId: In(partIds),
            });
          }
        }
        const keptDuties: ClearedDuty[] = [];
        if (input.duties) {
          const rows = await em.getRepository(Duty).find({
            where: {
              congregationId,
              weekStartDate: week,
              eventType: kind as unknown as EventType,
            },
            lock: { mode: 'pessimistic_write' },
          });
          for (const d of rows) {
            keptDuties.push({
              dutyType: String(d.dutyType),
              slotIndex: d.slotIndex,
              sortOrder: d.sortOrder,
              customLabel: d.customLabel,
              publisherId: d.publisherId,
              notes: d.notes,
            });
          }
          if (rows.length) {
            await em.getRepository(AssignmentNotice).delete({
              congregationId,
              itemType: 'duty',
              itemId: In(rows.map((d) => d.id)),
            });
            await em.getRepository(Duty).remove(rows);
          }
        }
        if (cleared.length + keptDuties.length === 0) {
          throw new ConflictException(
            refusal('NOT_HELD_NOTHING_LEFT', 'Nothing left to take off'),
          );
        }
        const row = await em.getRepository(NotHeldClearance).save(
          em.getRepository(NotHeldClearance).create({
            congregationId,
            weekStartDate: week,
            eventType: kind,
            reason,
            reasonEventId: null,
            parts: cleared,
            duties: keptDuties,
            clearedById: user.id,
          }),
        );
        await em.getRepository(NotHeldAlert).delete({
          congregationId,
          weekStartDate: week,
          eventType: kind,
        });
        return { row, cleared, keptDuties, talk, partIds };
      });
    // After the commit: what other sections keep of their own.
    for (const id of partIds) {
      await this.localNeeds.releaseAssignment(congregationId, id);
    }
    // The guest speaker's entry learns the weekend is cancelled — and the
    // talk coordinator is asked to tell his congregation.
    if (talk) {
      await this.talkExchange.syncProgramToJournal(congregationId, week, {});
    }
    await this.audit.logFact({
      tenantId: congregationId,
      entityType: 'not_held_clearance',
      entityId: row.id,
      action: 'DELETE',
      actorUserId: user.id,
      detail: {
        weekStartDate: week,
        eventType: kind,
        reason,
        parts: cleared.length,
        duties: keptDuties.length,
      },
    });
    return {
      clearanceId: row.id,
      parts: cleared.length,
      duties: keptDuties.length,
    };
  }

  // ── Giving them back ──────────────────────────────────────────────────

  /**
   * Puts back what a clearance took off. A part whose place was filled since
   * is left alone and named; so is a duty whose place is taken. When the
   * meeting is held again, the parts come back through the programme's own
   * path — their people hear «у вас часть» like any change. While it is still
   * not held (an undo a moment later), they come back as quietly as they went.
   */
  async restore(
    congregationId: string,
    user: AuthenticatedUser,
    clearanceId: string,
  ): Promise<{ parts: number; duties: number; skipped: string[] }> {
    const row = await this.clearances.findOne({
      where: { id: clearanceId, congregationId },
    });
    if (!row) throw new NotFoundException('Nothing to give back');
    const already = () =>
      new ConflictException(
        refusal('NOT_HELD_ALREADY_RESTORED', 'Already given back'),
      );
    if (row.restoredAt) throw already();
    const kind = row.eventType as MeetingKind;
    const week = day(row.weekStartDate);
    const rights = await this.rightsOf(user);
    if (row.parts.length && !rights[kind])
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Not your meeting', {
          responsibilities:
            EVENT_TYPE_RESPONSIBILITY[kind as unknown as EventType],
        }),
      );
    if (row.duties.length && !rights.duties)
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Not your duties', {
          responsibilities: EVENT_TYPE_RESPONSIBILITY[EventType.AV_DUTY],
        }),
      );
    const lock = await this.freeze.lockOf(congregationId, {
      weekStartDate: week,
      eventType: kind as unknown as EventType,
    });
    if (lock.held)
      throw new ConflictException(
        refusal('NOT_HELD_PAST', 'This meeting is already past'),
      );
    const rules = await this.weekRules.forWeek(congregationId, week);
    const heldAgain = NotHeldService.reasonOf(rules, kind) === null;
    const me = await this.users.findOne({
      where: { id: user.id },
      select: { id: true, uiLanguage: true },
    });
    const lang = coerceLanguage(me?.uiLanguage);

    // Claimed before anything is written: two presses at once give back once.
    const claim = await this.clearances
      .createQueryBuilder()
      .update(NotHeldClearance)
      .set({ restoredAt: () => 'now()', restoredById: user.id })
      .where('id = :id AND congregation_id = :cid AND restored_at IS NULL', {
        id: row.id,
        cid: congregationId,
      })
      .execute();
    if (!claim.affected) throw already();
    try {
      return await this.giveBack(congregationId, user, row, heldAgain, lang);
    } catch (e) {
      // Nothing is lost: the record can be given back again.
      await this.clearances.update(
        { id: row.id, congregationId },
        { restoredAt: null, restoredById: null },
      );
      throw e;
    }
  }

  private async giveBack(
    congregationId: string,
    user: AuthenticatedUser,
    row: NotHeldClearance,
    heldAgain: boolean,
    lang: SupportedLanguage,
  ): Promise<{ parts: number; duties: number; skipped: string[] }> {
    const kind = row.eventType as MeetingKind;
    const week = day(row.weekStartDate);
    const skipped: string[] = [];
    let parts = 0;
    let talk = false;
    for (const p of row.parts) {
      const a = await this.assignments.findOne({
        where: { id: p.id, congregationId },
      });
      if (!a || a.status !== AssignmentStatus.CANCELLED) {
        if (a) skipped.push(this.partLabel(a, lang));
        continue;
      }
      const taken = await this.assignments.findOne({
        where: {
          congregationId,
          weekStartDate: week,
          eventType: a.eventType,
          partKey: a.partKey,
          partOrder: a.partOrder,
          status: Not(AssignmentStatus.CANCELLED),
          id: Not(a.id),
        },
      });
      if (taken) {
        skipped.push(this.partLabel(a, lang));
        continue;
      }
      if (heldAgain) {
        // The programme's own path: news for its brother, the guest's entry.
        await this.assignmentsService.update(
          congregationId,
          a.id,
          { status: p.status as AssignmentStatus },
          user,
        );
      } else {
        await this.assignments.update(
          { id: a.id, congregationId },
          { status: p.status as AssignmentStatus },
        );
        if (a.partKey === PUBLIC_TALK) talk = true;
      }
      parts += 1;
    }
    if (talk)
      await this.talkExchange.syncProgramToJournal(congregationId, week, {});
    let duties = 0;
    for (const d of row.duties) {
      const taken = await this.duties.findOne({
        where: {
          congregationId,
          weekStartDate: week,
          eventType: kind as unknown as EventType,
          dutyType: d.dutyType as Duty['dutyType'],
          slotIndex: d.slotIndex,
        },
      });
      if (taken) {
        skipped.push(
          labelOf(
            {
              type: 'duty',
              labelKey: d.dutyType,
              labelTitle: d.customLabel,
              assistant: false,
              slot: d.dutyType === 'microphone' ? d.slotIndex + 1 : null,
            },
            lang,
          ),
        );
        continue;
      }
      await this.duties.save(
        this.duties.create({
          congregationId,
          weekStartDate: week,
          eventType: kind as unknown as EventType,
          dutyType: d.dutyType as Duty['dutyType'],
          slotIndex: d.slotIndex,
          sortOrder: d.sortOrder,
          customLabel: d.customLabel,
          publisherId: d.publisherId,
          notes: d.notes,
        }),
      );
      duties += 1;
    }
    // Given back while the meeting is still not held: its editor already
    // knows, and has just chosen this — no «assignments without a meeting»
    // a quarter of an hour later.
    if (!heldAgain && parts + duties > 0) {
      await this.alerts.upsert(
        {
          congregationId,
          weekStartDate: week,
          eventType: kind,
          count: parts + duties,
        },
        ['congregationId', 'weekStartDate', 'eventType'],
      );
    }
    await this.audit.logFact({
      tenantId: congregationId,
      entityType: 'not_held_clearance',
      entityId: row.id,
      action: 'RESTORE',
      actorUserId: user.id,
      detail: {
        weekStartDate: week,
        eventType: kind,
        parts,
        duties,
        skipped: skipped.length,
      },
    });
    return { parts, duties, skipped };
  }

  private partLabel(a: Assignment, lang: SupportedLanguage): string {
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

  // ── Telling the one who keeps the programme ───────────────────────────

  /**
   * Once per meeting: whoever keeps it hears that assignments stand on a
   * meeting that is not held — at the moment it happens (an event entered
   * after the programme was published), not when somebody happens to open
   * the week. Nothing for a meeting cleared since; told again if it fills up
   * again later.
   */
  async alertAll(): Promise<number> {
    let sent = 0;
    const all = await this.congregations.find({ select: { id: true } });
    for (const c of all) {
      try {
        sent += await this.alert(c.id);
      } catch (e) {
        this.logger.error(`not-held alert failed for ${c.id}: ${String(e)}`);
      }
    }
    return sent;
  }

  async alert(congregationId: string): Promise<number> {
    const now = await this.find(congregationId, null);
    const known = await this.alerts.find({ where: { congregationId } });
    const key = (w: string, k: string) => `${w}|${k}`;
    const live = new Set(now.map((m) => key(m.weekStartDate, m.eventType)));
    for (const a of known) {
      if (!live.has(key(day(a.weekStartDate), a.eventType))) {
        await this.alerts.delete({
          congregationId,
          weekStartDate: a.weekStartDate,
          eventType: a.eventType,
        });
      }
    }
    const told = new Set(
      known.map((a) => key(day(a.weekStartDate), a.eventType)),
    );
    let sent = 0;
    for (const m of now) {
      if (told.has(key(m.weekStartDate, m.eventType))) continue;
      const types = [
        ...(m.parts.length
          ? EVENT_TYPE_RESPONSIBILITY[m.eventType as unknown as EventType]
          : []),
        ...(m.duties.length
          ? EVENT_TYPE_RESPONSIBILITY[EventType.AV_DUTY]
          : []),
      ];
      const readers = await this.editorsOf(congregationId, types);
      const count = m.parts.length + m.duties.length;
      // Each round of «filled again after a clearance» is a new message; the
      // key keeps one round to one message even if two runs overlap.
      const round = await this.clearances.count({
        where: {
          congregationId,
          weekStartDate: m.weekStartDate,
          eventType: m.eventType,
        },
      });
      for (const u of readers) {
        const lang = coerceLanguage(u.uiLanguage);
        const w = WORDS[lang];
        const dayOf = formatDay(m.date ?? m.weekStartDate, lang);
        // «Региональный конгресс 20–22 ноября: 20 назначений без встречи».
        const what = m.event
          ? `${m.event.title} ${formatSpan(m.event.date, m.event.endDate, lang)}`
          : dayOf;
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: [u.id],
          title: w.title(what, count),
          body: w.body(dayOf),
          kind: 'schedule',
          key: `not_held:${m.weekStartDate}:${m.eventType}:${round}:${u.id}`,
          data: {
            type: 'meeting_not_held',
            weekStartDate: m.weekStartDate,
            eventType: m.eventType,
          },
        });
      }
      await this.alerts.save(
        this.alerts.create({
          congregationId,
          weekStartDate: m.weekStartDate,
          eventType: m.eventType,
          count,
        }),
      );
      sent += 1;
    }
    return sent + (await this.alertHeldAgain(congregationId));
  }

  /**
   * The event moved and the meeting is held again: what was taken off waits
   * on the week. Its editors are told once (8 November 2026), or it would
   * wait until somebody happened to open that week.
   */
  private async alertHeldAgain(congregationId: string): Promise<number> {
    const today = await this.clock.todayFor(congregationId);
    const rows = await this.clearances.find({
      where: {
        congregationId,
        restoredAt: IsNull(),
        heldAgainToldAt: IsNull(),
        weekStartDate: MoreThanOrEqual(mondayOf(today)),
      },
    });
    if (rows.length === 0) return 0;
    const ctx = await this.weekRules.contextOf(congregationId);
    let sent = 0;
    for (const r of rows) {
      const kind = r.eventType as MeetingKind;
      const week = day(r.weekStartDate);
      const rules = this.weekRules.rulesFrom(ctx, week);
      if (NotHeldService.reasonOf(rules, kind) !== null) continue;
      const lock = await this.freeze.lockOf(congregationId, {
        weekStartDate: week,
        eventType: kind as unknown as EventType,
      });
      if (lock.held) continue;
      const types = [
        ...(r.parts.length
          ? EVENT_TYPE_RESPONSIBILITY[kind as unknown as EventType]
          : []),
        ...(r.duties.length
          ? EVENT_TYPE_RESPONSIBILITY[EventType.AV_DUTY]
          : []),
      ];
      const count = r.parts.length + r.duties.length;
      for (const u of await this.editorsOf(congregationId, types)) {
        const lang = coerceLanguage(u.uiLanguage);
        const w = WORDS[lang];
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: [u.id],
          title: w.againTitle(formatDay(rules.dateOf(kind) ?? week, lang)),
          body: w.againBody(count),
          kind: 'schedule',
          key: `not_held_back:${r.id}:${u.id}`,
          data: {
            type: 'meeting_not_held',
            weekStartDate: week,
            eventType: kind,
          },
        });
      }
      await this.clearances.update(
        { id: r.id, congregationId },
        { heldAgainToldAt: new Date() },
      );
      sent += 1;
    }
    return sent;
  }

  /** Who keeps these: the holders of the responsibilities, else the admins. */
  private async editorsOf(
    congregationId: string,
    types: ResponsibilityType[],
  ): Promise<Pick<User, 'id' | 'uiLanguage'>[]> {
    let userIds = types.length
      ? (
          await this.responsibilities.find({
            where: { congregationId, type: In(types) },
            select: { userId: true },
          })
        ).map((r) => r.userId)
      : [];
    if (userIds.length === 0) {
      userIds = (
        await this.users.find({
          where: { congregationId, role: UserRole.ADMIN, isActive: true },
          select: { id: true },
        })
      ).map((u) => u.id);
    }
    if (userIds.length === 0) return [];
    return this.users.find({
      where: { id: In([...new Set(userIds)]), isActive: true },
      select: { id: true, uiLanguage: true },
    });
  }

  private async namesOf(
    congregationId: string,
    ids: (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (want.length === 0) return new Map();
    const cards = await this.publishers.find({
      where: { congregationId, id: In(want) },
      withDeleted: true,
    });
    return new Map(cards.map((p) => [p.id, p.displayName]));
  }
}

/** A line that names somebody — not a song or a heading. */
const hasPerson = (a: Assignment): boolean =>
  !!(a.publisherId || a.assistantPublisherId || a.speakerName?.trim());

const day = (d: string | Date): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

function formatDay(iso: string, lang: SupportedLanguage): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** «20–22 ноября», «20.–22. November», «November 20 – 22»; one day as one day. */
function formatSpan(
  from: string,
  to: string | null,
  lang: SupportedLanguage,
): string {
  if (!to || to === from) return formatDay(from, lang);
  const at = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  return new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).formatRange(at(from), at(to));
}

/** Russian has three forms; the server runs on Node, which has PluralRules. */
function plural(
  lang: 'ru',
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const form = new Intl.PluralRules(lang).select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
}
