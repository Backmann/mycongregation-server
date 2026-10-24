import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import {
  FieldServiceTemplateSlot,
  type ConductorRule,
} from '../entities/field-service-template-slot.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Absence } from '../entities/absence.entity';
import { FieldServiceRemovedDay } from '../entities/field-service-removed-day.entity';
import { Gender } from '../common/enums/gender.enum';
import { mondayOf } from '../common/week';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { HallBusyService, type HallBusy } from './hall-busy.service';
import {
  FieldServiceTemplateService,
  slotDatesInMonth,
} from './field-service-template.service';

/** Add n days to an ISO 'YYYY-MM-DD' date (UTC, calendar-safe). */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function meetingDateISO(m: {
  weekStartDate: string;
  dayOfWeek: number;
}): string {
  return addDaysISO(m.weekStartDate, m.dayOfWeek - 1);
}

function isoDow(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Events that cancel a field-service meeting on their days. */
const ASSEMBLY_TYPES = ['circuit_assembly', 'regional_convention'];

/**
 * Why a brother stands where he stands in the list. The app puts the words
 * to each code in the reader's language.
 */
export type CandidateReason =
  | 'never_led' // has never conducted
  | 'last_led' // conducted last on `lastDate`
  | 'upcoming' // already put on a meeting after this day (`lastDate` is it)
  | 'group_overseer' // the group's own overseer
  | 'group_assistant' // the group's assistant (its overseer not free)
  | 'leads_that_day' // already conducts another meeting on that day
  | 'absent' // away on that day
  // The group's overseer or assistant without the card switch «Проводит
  // встречу для проповеди», or not active: shown so the overseer sees why
  // he is not first, never picked (24 October 2026) — saving him would be
  // refused with FS_NOT_A_CONDUCTOR anyway.
  | 'not_conductor';

export interface ConductorCandidate {
  publisherId: string;
  name: string;
  reason: CandidateReason;
  /** With `last_led`: the day he conducted last. */
  lastDate: string | null;
  /** Free to be picked. The others are shown for the overseer to overrule. */
  free: boolean;
}

export type PlannedStatus =
  | 'create' // will be made
  | 'exists' // a meeting already stands there
  | 'assembly' // an assembly or convention takes the day
  | 'co_visit' // the circuit overseer's week: its own schedule applies
  | 'past' // the day is gone
  // The slot's group was removed: the row sleeps until it is restored.
  | 'group_removed'
  // A meeting like it was deleted by hand on that day: not brought back.
  | 'removed'
  // A meeting for the whole congregation already stands that day at another
  // time and place — the template changed since. Not made beside it;
  // `existingId` is the one standing, for the app to offer to change it.
  | 'differs';

export interface PlannedRow {
  date: string;
  dayOfWeek: number;
  startTime: string;
  address: string;
  serviceGroupId: string | null;
  /** Without a group: the congregation's own (true) or the groups' on their own. */
  isGeneral: boolean;
  groupName: string | null;
  conductorRule: ConductorRule;
  status: PlannedStatus;
  /**
   * With `exists`, `assembly`, `co_visit`: what stands in the way; with
   * `group_removed` the group's name; with `differs` the standing meeting's
   * «time · place».
   */
  because: string | null;
  /** With `differs`: the meeting that stands there. */
  existingId?: string | null;
  conductor: ConductorCandidate | null;
  /** With `create` and no conductor: why none could be picked. */
  noConductor: 'rule_none' | 'nobody_free' | 'no_overseer' | null;
  /**
   * What else is on that day — the pioneer school, an event. Said, never
   * acted on: the meeting is still made, the planner decides where.
   */
  busy: HallBusy[];
}

export interface MonthPreview {
  year: number;
  month: number;
  rows: PlannedRow[];
  /** Already in the month, drafts included — shown, never touched. */
  existing: {
    id: string;
    date: string;
    startTime: string;
    address: string;
    serviceGroupId: string | null;
    conductorPublisherId: string | null;
    serviceOverseerVisit: boolean;
    published: boolean;
  }[];
}

export interface PrepareResult {
  created: number;
  withoutConductor: number;
  skipped: Record<Exclude<PlannedStatus, 'create'>, number>;
}

/**
 * How a month is prepared from the template (October 2026).
 *
 * The overseer used to generate empty Saturdays and then fill each by hand,
 * with a calendar open beside the app. This does what he did: reads the
 * congregation's calendar (an assembly takes its days; the circuit
 * overseer's week has its own schedule), leaves a day alone when something
 * already stands there, and for every slot that says so picks the conductor
 * the way the slot says — the group's overseer, or the brother whose turn it
 * is. The result is a DRAFT month: seen by the planners, told to nobody,
 * announced when he says so.
 *
 * `preview` and `prepare` are the same computation; `prepare` writes it.
 */
@Injectable()
export class FieldServicePlannerService {
  constructor(
    @InjectRepository(FieldServiceMeeting)
    private readonly meetingRepo: Repository<FieldServiceMeeting>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(SpecialEvent)
    private readonly eventsRepo: Repository<SpecialEvent>,
    @InjectRepository(Absence)
    private readonly absencesRepo: Repository<Absence>,
    private readonly template: FieldServiceTemplateService,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    private readonly hallBusy: HallBusyService,
    // Optional so the specs that build this by hand need not carry it.
    @Optional()
    @InjectRepository(FieldServiceRemovedDay)
    private readonly removedRepo?: Repository<FieldServiceRemovedDay>,
  ) {}

  // ---- who may conduct ----------------------------------------------------

  /**
   * The circle of conductors, with when each conducted last — drafts counted,
   * so that a month being prepared spreads its Saturdays over the circle
   * instead of giving them all to the brother who was free on the 1st.
   */
  private async circle(
    congregationId: string,
    before: string,
    excludeMeetingId: string | null = null,
  ) {
    const people = new Map(
      (
        await this.publishersRepo.find({
          where: { congregationId, removedAt: IsNull() },
        })
      ).map((p) => [p.id, p]),
    );
    const brothers = [...people.values()].filter(
      (p) =>
        p.isActive &&
        p.gender === Gender.BROTHER &&
        p.capabilities?.fs_meeting_conductor === true,
    );
    // A cancelled meeting was nobody's turn and books nobody.
    const led = await this.meetingRepo.find({
      where: { congregationId, cancelledAt: IsNull() },
      select: {
        id: true,
        weekStartDate: true,
        dayOfWeek: true,
        conductorPublisherId: true,
      },
    });
    const lastLed = new Map<string, string>();
    // His soonest meeting on or after `before`: a brother already down for
    // a later Saturday goes to the back of the queue, as the old window had
    // it — «уже назначен на …» is the reason not to choose him today.
    const upcoming = new Map<string, string>();
    for (const m of led) {
      // The meeting being edited is not a booking that counts against its
      // own conductor: he stood at the top with «уже назначен на» its own
      // date (seen on the phone, 11 October 2026).
      if (m.id === excludeMeetingId) continue;
      if (!m.conductorPublisherId) continue;
      const d = meetingDateISO(m);
      if (d >= before) {
        const cur = upcoming.get(m.conductorPublisherId);
        if (!cur || d < cur) upcoming.set(m.conductorPublisherId, d);
        continue;
      }
      const cur = lastLed.get(m.conductorPublisherId);
      if (!cur || d > cur) lastLed.set(m.conductorPublisherId, d);
    }
    return { brothers, people, lastLed, upcoming };
  }

  /** Who conducts something on each day of the span, drafts included. */
  private async busyByDay(
    congregationId: string,
    from: string,
    to: string,
    excludeMeetingId: string | null,
  ): Promise<Map<string, Set<string>>> {
    const rows = await this.meetingRepo.find({
      where: {
        congregationId,
        weekStartDate: Between(mondayOf(from), mondayOf(to)),
        // Called off: whoever was on it is free that day.
        cancelledAt: IsNull(),
      },
    });
    const out = new Map<string, Set<string>>();
    for (const m of rows) {
      if (m.id === excludeMeetingId) continue;
      const d = meetingDateISO(m);
      const set = out.get(d) ?? new Set<string>();
      if (m.conductorPublisherId) set.add(m.conductorPublisherId);
      if (m.serviceOverseerVisit) {
        if (m.serviceOverseerPublisherId) set.add(m.serviceOverseerPublisherId);
        if (m.serviceOverseerAssistantId) set.add(m.serviceOverseerAssistantId);
      }
      out.set(d, set);
    }
    return out;
  }

  /** Who is away on each day of the span. */
  private async absentByDay(
    congregationId: string,
    from: string,
    to: string,
  ): Promise<(publisherId: string, date: string) => boolean> {
    const rows = await this.absencesRepo.find({
      where: { congregationId, startDate: LessThanOrEqual(to) },
    });
    const spans = rows
      .filter((a) => (a.endDate ?? a.startDate) >= from)
      .map((a) => ({
        pid: a.publisherId,
        from: a.startDate,
        to: a.endDate ?? a.startDate,
      }));
    return (pid, date) =>
      spans.some((s) => s.pid === pid && s.from <= date && date <= s.to);
  }

  /**
   * The candidates for ONE meeting, best first — the window «Кто ведёт» and
   * the generator both read this list.
   *
   * Free brothers first: the one who never conducted, then the one who
   * conducted longest ago. Then those who cannot be picked on that day —
   * away, or already conducting something — each with its reason, so the
   * overseer sees why and may overrule. For a group's meeting with the rule
   * «its overseer», the group's own overseer stands first when free, his
   * assistant next.
   */
  async suggestConductor(
    congregationId: string,
    opts: {
      date: string;
      serviceGroupId?: string | null;
      conductorRule?: ConductorRule;
      excludeMeetingId?: string | null;
    },
  ): Promise<ConductorCandidate[]> {
    const groups = await this.template.groupsOf(congregationId);
    const { brothers, people, lastLed, upcoming } = await this.circle(
      congregationId,
      opts.date,
      opts.excludeMeetingId ?? null,
    );
    const busy = await this.busyByDay(
      congregationId,
      opts.date,
      opts.date,
      opts.excludeMeetingId ?? null,
    );
    const absent = await this.absentByDay(congregationId, opts.date, opts.date);
    return this.rank(
      brothers,
      people,
      lastLed,
      upcoming,
      busy.get(opts.date) ?? new Set(),
      (pid) => absent(pid, opts.date),
      opts.serviceGroupId ? (groups.get(opts.serviceGroupId) ?? null) : null,
      opts.conductorRule ?? 'rotation',
    );
  }

  private rank(
    brothers: Publisher[],
    people: Map<string, Publisher>,
    lastLed: Map<string, string>,
    upcoming: Map<string, string>,
    busyToday: Set<string>,
    isAbsent: (pid: string) => boolean,
    group: ServiceGroup | null,
    rule: ConductorRule,
  ): ConductorCandidate[] {
    const name = (p: Publisher) =>
      p.displayName || `${p.lastName} ${p.firstName}`.trim();
    const one = (
      p: Publisher,
      reason: CandidateReason,
      free: boolean,
    ): ConductorCandidate => ({
      publisherId: p.id,
      name: name(p),
      reason,
      lastDate: lastLed.get(p.id) ?? null,
      free,
    });
    const blocked = (p: Publisher): ConductorCandidate | null =>
      isAbsent(p.id)
        ? one(p, 'absent', false)
        : busyToday.has(p.id)
          ? one(p, 'leads_that_day', false)
          : null;

    const out: ConductorCandidate[] = [];
    const taken = new Set<string>();
    // The group's own men first, when the rule asks for them. They need not
    // be in the circle: the group is theirs by appointment.
    if (rule === 'group_overseer' && group) {
      for (const [pid, reason] of [
        [group.overseerPublisherId, 'group_overseer'],
        [group.assistantPublisherId, 'group_assistant'],
      ] as const) {
        if (!pid || taken.has(pid)) continue;
        const p = people.get(pid);
        // Appointed but no longer here (removed): not a candidate at all.
        if (!p) continue;
        taken.add(pid);
        // Not one who conducts: shown with the reason, never picked. Put
        // first he was saved on a draft by the month's preparation and
        // refused the moment a person saved him by hand (sync audit M3).
        if (!p.isActive || p.capabilities?.fs_meeting_conductor !== true) {
          out.push(one(p, 'not_conductor', false));
          continue;
        }
        out.push(blocked(p) ?? one(p, reason, true));
      }
    }
    const rest = brothers.filter((p) => !taken.has(p.id));
    const free = rest.filter((p) => !blocked(p) && !upcoming.has(p.id));
    const later = rest.filter((p) => !blocked(p) && upcoming.has(p.id));
    const notFree = rest.filter((p) => blocked(p));
    free.sort((a, b) => {
      const la = lastLed.get(a.id);
      const lb = lastLed.get(b.id);
      if (!la && lb) return -1;
      if (la && !lb) return 1;
      if (la && lb && la !== lb) return la < lb ? -1 : 1;
      return name(a).localeCompare(name(b), 'ru');
    });
    for (const p of free) {
      out.push(one(p, lastLed.has(p.id) ? 'last_led' : 'never_led', true));
    }
    // Still free — just not first in line. Soonest booking last.
    later.sort(
      (a, b) =>
        upcoming.get(a.id)!.localeCompare(upcoming.get(b.id)!) * -1 ||
        name(a).localeCompare(name(b), 'ru'),
    );
    for (const p of later) {
      out.push({ ...one(p, 'upcoming', true), lastDate: upcoming.get(p.id)! });
    }
    for (const p of notFree) out.push(blocked(p)!);
    // The group's men who do not conduct go last, after everyone who can.
    return [
      ...out.filter((c) => c.reason !== 'not_conductor'),
      ...out.filter((c) => c.reason === 'not_conductor'),
    ];
  }

  // ---- the month ----------------------------------------------------------

  /** Everything that stands in a month's way, read once per run. */
  private async calendar(congregationId: string, year: number, month: number) {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const next =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const last = addDaysISO(next, -1);
    const settings = await this.template.getSettings(congregationId);
    const events = await this.eventsRepo.find({
      where: {
        congregationId,
        type: In([...ASSEMBLY_TYPES, 'circuit_overseer_visit']),
        // Six days past the month: a visit that begins on Tuesday the 1st
        // has its Monday — the 30th — in this month, and that week is the
        // visit's (sync audit L8).
        date: LessThanOrEqual(addDaysISO(last, 6)),
      },
    });
    const assemblies = settings.skipAssemblies
      ? events.filter(
          (e) =>
            ASSEMBLY_TYPES.includes(e.type ?? '') &&
            (e.endDate ?? e.date) >= first,
        )
      : [];
    // The visit's WEEK, Monday to Sunday: the schedule of the visit holds
    // that whole week's outings.
    const visitWeeks = settings.coVisitFromSchedule
      ? events
          .filter(
            (e) =>
              e.type === 'circuit_overseer_visit' &&
              addDaysISO(mondayOf(e.endDate ?? e.date), 6) >= first,
          )
          .map((e) => ({
            from: mondayOf(e.date),
            to: addDaysISO(mondayOf(e.endDate ?? e.date), 6),
            title: e.title,
          }))
      : [];
    const assemblyOn = (d: string) =>
      assemblies.find((e) => e.date <= d && d <= (e.endDate ?? e.date)) ?? null;
    const visitOn = (d: string) =>
      visitWeeks.find((w) => w.from <= d && d <= w.to) ?? null;
    return { first, last, assemblyOn, visitOn };
  }

  /**
   * What takes a single day away from field service, by the same rule the
   * month's preparation follows (16 October 2026): an assembly or a
   * convention on that day, or the week of the circuit overseer's visit —
   * each only when the congregation's settings say so. A meeting put or
   * moved there by hand is refused; until now only preparation knew.
   */
  async dayTaken(
    congregationId: string,
    date: string,
  ): Promise<{ kind: 'assembly' | 'co_visit'; title: string | null } | null> {
    const [y, m] = date.split('-').map(Number);
    const cal = await this.calendar(congregationId, y, m);
    const assembly = cal.assemblyOn(date);
    if (assembly) return { kind: 'assembly', title: assembly.title ?? null };
    const visit = cal.visitOn(date);
    if (visit) return { kind: 'co_visit', title: visit.title ?? null };
    return null;
  }

  /**
   * The month as it will be — every slot's date with what happens to it.
   * Nothing is written. `pickConductors: false` leaves every conductor empty.
   */
  async preview(
    congregationId: string,
    year: number,
    month: number,
    pickConductors = true,
  ): Promise<MonthPreview> {
    const slots = await this.template.getSlots(congregationId);
    const groups = await this.template.groupsOf(congregationId);
    const allGroups = await this.template.groupsOf(congregationId, true);
    const today = await this.clock.todayFor(congregationId);
    const cal = await this.calendar(congregationId, year, month);
    const removed = this.removedRepo
      ? await this.removedRepo.find({
          where: { congregationId, date: Between(cal.first, cal.last) },
        })
      : [];
    const existing = await this.template.meetingsOfMonth(
      congregationId,
      year,
      month,
    );
    // Turns are counted up to the END of the month: a brother who already
    // has a Saturday in it — a draft, or one put in by hand — goes to the
    // back of the queue for the rest of it.
    const { brothers, people, lastLed, upcoming } = await this.circle(
      congregationId,
      addDaysISO(cal.last, 1),
    );
    const busy = await this.busyByDay(
      congregationId,
      cal.first,
      cal.last,
      null,
    );
    const absent = await this.absentByDay(congregationId, cal.first, cal.last);
    const soft = await this.hallBusy.softByDay(
      congregationId,
      cal.first,
      cal.last,
    );
    // What the run itself puts on each day joins what already stands there.
    type Stands = { time: string; place: string; groupId: string | null };
    const place = (a: string) => a.trim().toLowerCase();
    const onDay = new Map<string, Stands[]>();
    const note = (m: {
      date: string;
      startTime: string;
      address: string;
      serviceGroupId: string | null;
    }) => {
      const list = onDay.get(m.date) ?? [];
      list.push({
        time: m.startTime,
        place: place(m.address),
        groupId: m.serviceGroupId,
      });
      onDay.set(m.date, list);
    };
    for (const m of existing) note({ ...m, date: meetingDateISO(m) });
    // What a person deleted (or moved away) on each day, in the same shape.
    const gone = new Map<
      string,
      { groupId: string | null; general: boolean }[]
    >();
    for (const r of removed) {
      const d = String(r.date).slice(0, 10);
      const list = gone.get(d) ?? [];
      list.push({ groupId: r.serviceGroupId, general: r.isGeneral });
      gone.set(d, list);
    }
    /**
     * Does something already stand where the slot would go? A group that
     * has a meeting that day (a visit, say) is not given a second one. A
     * general meeting stands down for ANY meeting at its time, and for
     * another general one at its place — the old generator's rule, which
     * catches a Saturday moved by hand from 10:30 to 10:00. A group's own
     * meeting at another time is no obstacle to the general one.
     */
    const standsThere = (
      date: string,
      slot: FieldServiceTemplateSlot,
      address: string,
    ): boolean => {
      const list = onDay.get(date) ?? [];
      const p = place(address);
      if (slot.serviceGroupId) {
        return list.some(
          (x) =>
            x.groupId === slot.serviceGroupId ||
            (x.time === slot.startTime && p !== '' && x.place === p),
        );
      }
      return list.some(
        (x) =>
          x.time === slot.startTime ||
          (x.groupId === null && p !== '' && x.place === p),
      );
    };

    /**
     * Was a meeting of this slot's kind deleted (or moved away) on that day?
     * Of its own kind, whatever its hour and place: the day was taken out
     * for that group, or for the congregation's meeting, even if the
     * template has since moved it to 09:30 in the park. A group's Saturday
     * taken out says nothing about the congregation's, nor the other way
     * round.
     */
    const wasRemoved = (
      date: string,
      slot: FieldServiceTemplateSlot,
    ): boolean =>
      (gone.get(date) ?? []).some((x) =>
        slot.serviceGroupId
          ? x.groupId === slot.serviceGroupId
          : x.groupId === null && x.general === slot.isGeneral,
      );

    // Dates first, then slots on the same date: the circle is walked in
    // calendar order, so the brother picked for the 7th is not asked again
    // on the 14th while others wait.
    const planned: { date: string; slot: FieldServiceTemplateSlot }[] = [];
    for (const slot of slots) {
      for (const date of slotDatesInMonth(slot, year, month)) {
        planned.push({ date, slot });
      }
    }
    planned.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.slot.startTime.localeCompare(b.slot.startTime) ||
        a.slot.position - b.slot.position,
    );

    // The congregation's meetings that no general slot of their day
    // accounts for — what the template said before it changed. A general
    // slot that finds nothing of its own that day is paired with one of
    // these instead of being made beside it (sync audit M2, case C).
    const loose = new Map<string, FieldServiceMeeting[]>();
    for (const m of existing) {
      if (!m.isGeneral || m.serviceGroupId) continue;
      const d = meetingDateISO(m);
      const own = planned.some(
        (x) =>
          x.date === d &&
          x.slot.isGeneral &&
          !x.slot.serviceGroupId &&
          (x.slot.startTime === m.startTime ||
            (place(FieldServiceTemplateService.placeOf(x.slot, groups)) !==
              '' &&
              place(FieldServiceTemplateService.placeOf(x.slot, groups)) ===
                place(m.address))),
      );
      if (own) continue;
      const list = loose.get(d) ?? [];
      list.push(m);
      loose.set(d, list);
    }

    const rows: PlannedRow[] = [];
    for (const { date, slot } of planned) {
      const group = slot.serviceGroupId
        ? (groups.get(slot.serviceGroupId) ?? null)
        : null;
      const groupGone = !!slot.serviceGroupId && !group;
      const address = FieldServiceTemplateService.placeOf(slot, groups);
      const row: PlannedRow = {
        date,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        address,
        serviceGroupId: slot.serviceGroupId,
        isGeneral: slot.isGeneral,
        groupName:
          group?.name ??
          (slot.serviceGroupId
            ? (allGroups.get(slot.serviceGroupId)?.name ?? null)
            : null),
        conductorRule: slot.conductorRule,
        status: 'create',
        because: null,
        conductor: null,
        noConductor: null,
        busy: soft.get(date) ?? [],
      };
      const assembly = cal.assemblyOn(date);
      const visit = cal.visitOn(date);
      if (date < today) {
        row.status = 'past';
      } else if (groupGone) {
        row.status = 'group_removed';
        row.because = row.groupName;
      } else if (assembly) {
        row.status = 'assembly';
        row.because = assembly.title;
      } else if (visit) {
        row.status = 'co_visit';
        row.because = visit.title;
      } else if (standsThere(date, slot, address)) {
        row.status = 'exists';
      } else if (wasRemoved(date, slot)) {
        row.status = 'removed';
      } else if (
        slot.isGeneral &&
        !slot.serviceGroupId &&
        loose.get(date)?.length
      ) {
        const m = loose.get(date)!.shift()!;
        row.status = 'differs';
        row.because = [m.startTime, m.address].filter(Boolean).join(' · ');
        row.existingId = m.id;
      }
      if (row.status !== 'create') {
        rows.push(row);
        continue;
      }
      note({
        date,
        startTime: slot.startTime,
        address,
        serviceGroupId: slot.serviceGroupId,
      });
      if (!pickConductors || slot.conductorRule === 'none') {
        row.noConductor = 'rule_none';
      } else {
        const list = this.rank(
          brothers,
          people,
          lastLed,
          upcoming,
          busy.get(date) ?? new Set(),
          (pid) => absent(pid, date),
          group,
          slot.conductorRule,
        );
        const pick = list.find((c) => c.free) ?? null;
        if (pick) {
          row.conductor = pick;
          // He is taken that day, and his turn has just come round.
          lastLed.set(pick.publisherId, date);
          const set = busy.get(date) ?? new Set<string>();
          set.add(pick.publisherId);
          busy.set(date, set);
        } else {
          row.noConductor =
            slot.conductorRule === 'group_overseer' &&
            !group?.overseerPublisherId &&
            !group?.assistantPublisherId
              ? 'no_overseer'
              : 'nobody_free';
        }
      }
      rows.push(row);
    }

    return {
      year,
      month,
      rows,
      existing: existing.map((m) => ({
        id: m.id,
        date: meetingDateISO(m),
        startTime: m.startTime,
        address: m.address,
        serviceGroupId: m.serviceGroupId,
        conductorPublisherId: m.conductorPublisherId,
        serviceOverseerVisit: m.serviceOverseerVisit,
        published: m.publishedAt !== null,
      })),
    };
  }

  /**
   * «Подобрать ведущих» for a draft month, on the server (24 October 2026).
   *
   * The app did it in a loop of its own: every group meeting by «its
   * overseer», every other by rotation — whatever the template said, so a
   * slot set to «без ведущего» was filled — and the first refusal stopped
   * the loop halfway with no word of what was done (sync audit M3). Here
   * each draft follows the rule of the template slot it came from; a draft
   * no slot accounts for (added by hand) follows the old default. Turns and
   * days taken are counted as the month fills, the same as preparing it.
   * Drafts only — an announced meeting changes by hand, with its notice.
   */
  async fillConductors(
    congregationId: string,
    year: number,
    month: number,
  ): Promise<{
    filled: number;
    left: { id: string; date: string; why: 'nobody_free' | 'no_overseer' }[];
    ruleNone: number;
  }> {
    const today = await this.clock.todayFor(congregationId);
    const cal = await this.calendar(congregationId, year, month);
    const drafts = (
      await this.template.meetingsOfMonth(congregationId, year, month)
    )
      .filter(
        (m) =>
          m.publishedAt === null &&
          !m.cancelledAt &&
          !m.conductorPublisherId &&
          meetingDateISO(m) >= today,
      )
      .sort(
        (a, b) =>
          meetingDateISO(a).localeCompare(meetingDateISO(b)) ||
          a.startTime.localeCompare(b.startTime),
      );
    const out = {
      filled: 0,
      left: [] as {
        id: string;
        date: string;
        why: 'nobody_free' | 'no_overseer';
      }[],
      ruleNone: 0,
    };
    if (drafts.length === 0) return out;
    const slots = await this.template.getSlots(congregationId);
    const groups = await this.template.groupsOf(congregationId);
    const { brothers, people, lastLed, upcoming } = await this.circle(
      congregationId,
      addDaysISO(cal.last, 1),
    );
    const busy = await this.busyByDay(
      congregationId,
      cal.first,
      cal.last,
      null,
    );
    const absent = await this.absentByDay(congregationId, cal.first, cal.last);
    const ruleOf = (m: FieldServiceMeeting): ConductorRule => {
      const date = meetingDateISO(m);
      const mine = slots.filter(
        (sl) =>
          (m.serviceGroupId
            ? sl.serviceGroupId === m.serviceGroupId
            : !sl.serviceGroupId && sl.isGeneral === m.isGeneral) &&
          slotDatesInMonth(sl, year, month).includes(date),
      );
      const slot =
        mine.find((sl) => sl.startTime === m.startTime) ?? mine[0] ?? null;
      if (slot) return slot.conductorRule;
      return m.serviceGroupId ? 'group_overseer' : 'rotation';
    };
    const picked: { id: string; publisherId: string }[] = [];
    for (const m of drafts) {
      const date = meetingDateISO(m);
      const rule = ruleOf(m);
      if (rule === 'none') {
        out.ruleNone += 1;
        continue;
      }
      const group = m.serviceGroupId
        ? (groups.get(m.serviceGroupId) ?? null)
        : null;
      const list = this.rank(
        brothers,
        people,
        lastLed,
        upcoming,
        busy.get(date) ?? new Set(),
        (pid) => absent(pid, date),
        group,
        rule,
      );
      const pick = list.find((c) => c.free) ?? null;
      if (!pick) {
        out.left.push({
          id: m.id,
          date,
          why:
            rule === 'group_overseer' &&
            !group?.overseerPublisherId &&
            !group?.assistantPublisherId
              ? 'no_overseer'
              : 'nobody_free',
        });
        continue;
      }
      picked.push({ id: m.id, publisherId: pick.publisherId });
      lastLed.set(pick.publisherId, date);
      const set = busy.get(date) ?? new Set<string>();
      set.add(pick.publisherId);
      busy.set(date, set);
    }
    if (picked.length) {
      await this.meetingRepo.manager.transaction(async (em) => {
        const repo = em.getRepository(FieldServiceMeeting);
        for (const p of picked) {
          // Still empty and still a draft: a person may have filled it
          // since the list was read.
          await repo.update(
            {
              id: p.id,
              congregationId,
              conductorPublisherId: IsNull(),
              publishedAt: IsNull(),
            },
            { conductorPublisherId: p.publisherId },
          );
        }
      });
      out.filled = picked.length;
      // One line for the run, as publishing the month is: which drafts got
      // whom is the month view itself.
      await this.auditLog.logUpdate({
        tenantId: congregationId,
        entityType: 'field_service_meeting',
        entityId: picked[0].id,
        before: { conductorsFilled: null },
        after: {
          conductorsFilled: JSON.stringify({
            year,
            month,
            count: picked.length,
          }),
        },
        fields: ['conductorsFilled'],
      });
    }
    return out;
  }

  /**
   * Write the month `preview` showed, as DRAFTS. One line in the journal for
   * the run. Nobody is told: that is what publishing the month is for.
   */
  async prepare(
    congregationId: string,
    year: number,
    month: number,
    pickConductors = true,
  ): Promise<PrepareResult> {
    // One preparation of a congregation at a time (sync audit L2): two
    // presses, two tabs, or the night's pass during a deploy each read the
    // month empty and wrote it twice — there is no key on a meeting that
    // could refuse the second. The lock lives as long as the transaction;
    // the second run waits for the first to commit and then finds its
    // meetings standing.
    return this.meetingRepo.manager.transaction(async (em) => {
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `field-service-prepare:${congregationId}`,
      ]);
      return this.prepareLocked(em.getRepository(FieldServiceMeeting), {
        congregationId,
        year,
        month,
        pickConductors,
      });
    });
  }

  private async prepareLocked(
    repo: Repository<FieldServiceMeeting>,
    a: {
      congregationId: string;
      year: number;
      month: number;
      pickConductors: boolean;
    },
  ): Promise<PrepareResult> {
    const { congregationId, year, month, pickConductors } = a;
    const view = await this.preview(
      congregationId,
      year,
      month,
      pickConductors,
    );
    const result: PrepareResult = {
      created: 0,
      withoutConductor: 0,
      skipped: {
        exists: 0,
        assembly: 0,
        co_visit: 0,
        past: 0,
        group_removed: 0,
        removed: 0,
        differs: 0,
      },
    };
    const toInsert: FieldServiceMeeting[] = [];
    for (const r of view.rows) {
      if (r.status !== 'create') {
        result.skipped[r.status] += 1;
        continue;
      }
      if (!r.conductor) result.withoutConductor += 1;
      toInsert.push(
        repo.create({
          congregationId,
          weekStartDate: mondayOf(r.date),
          dayOfWeek: isoDow(r.date),
          startTime: r.startTime,
          address: r.address,
          conductorPublisherId: r.conductor?.publisherId ?? null,
          topic: null,
          sourceUrl: null,
          isGeneral: r.isGeneral,
          serviceGroupId: r.serviceGroupId,
          publishedAt: null,
        }),
      );
      result.created += 1;
    }
    if (toInsert.length) {
      const saved = await repo.save(toInsert);
      await this.auditLog.logEvent({
        tenantId: congregationId,
        entityType: 'field_service_meeting',
        entityId: saved[0]?.id ?? congregationId,
        action: 'CREATE' as never,
        detail: {
          bulk: true,
          draft: true,
          fromTemplate: true,
          year,
          month,
          count: saved.length,
          dates: saved.map(meetingDateISO).sort(),
          withoutConductor: result.withoutConductor,
          skipped: result.skipped,
        },
      });
    }
    return result;
  }
}
