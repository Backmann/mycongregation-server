import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { PioneerSchool } from '../entities/pioneer-school.entity';
import { PioneerSchoolDay } from '../entities/pioneer-school-day.entity';

/**
 * Event types the month preparation already treats as a HARD rule: the day
 * is skipped (an assembly or convention) or the week follows its own
 * schedule (the circuit overseer's visit). They are reported here too, so
 * the meeting window can still warn about them, but marked `hard`.
 */
const HARD_TYPES = new Set([
  'circuit_assembly',
  'regional_convention',
  'circuit_overseer_visit',
]);

export interface HallBusy {
  /** The day, YYYY-MM-DD. */
  date: string;
  kind: 'pioneer_school' | 'event';
  /** With `event`: its type as stored (`other`, `special_talk`, …). */
  eventType: string | null;
  title: string;
  /** Where it takes place, as written on it — or null. */
  place: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Already a rule of its own in the month preparation. */
  hard: boolean;
}

/** Every day from `from` to `to`, both included. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * What else is happening on a day — the soft side of the calendar
 * (13 October 2026).
 *
 * The month preparation knew two hard rules: an assembly takes the day, the
 * circuit overseer's week has its own schedule. Everything else in the
 * calendar was invisible to it — so the last week of November, when the
 * pioneer school sits in the Kingdom Hall through the Saturday, came out as
 * an ordinary Saturday in the hall, and the planner had to remember it.
 *
 * Nothing is cancelled or moved here: the congregation decides where it
 * meets instead. This only SAYS what is on, in one place, so that the
 * preview, the meeting window, the draft block and the nightly message all
 * ask the same question and get the same answer.
 */
@Injectable()
export class HallBusyService {
  constructor(
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(PioneerSchool)
    private readonly schools: Repository<PioneerSchool>,
    @InjectRepository(PioneerSchoolDay)
    private readonly schoolDays: Repository<PioneerSchoolDay>,
  ) {}

  /** What is on between two days, both included, in date order. */
  async between(
    congregationId: string,
    from: string,
    to: string,
  ): Promise<HallBusy[]> {
    const out: HallBusy[] = [];

    // Events that touch the span: begin on or before its end, end on or
    // after its start (a one-day event has no end date).
    const events = await this.events.find({
      where: { congregationId, date: LessThanOrEqual(to) },
    });
    for (const e of events) {
      const start = e.date.slice(0, 10);
      const end = (e.endDate ?? e.date).slice(0, 10);
      if (end < from) continue;
      for (const date of daysBetween(
        start < from ? from : start,
        end > to ? to : end,
      )) {
        out.push({
          date,
          kind: 'event',
          eventType: e.type ?? null,
          title: e.title,
          place: e.address?.trim() || null,
          startTime: e.time?.trim() || null,
          endTime: e.timeEnd?.trim() || null,
          hard: HARD_TYPES.has(e.type ?? ''),
        });
      }
    }

    // The pioneer school: its days carry their own hours when set, the
    // school's hours otherwise. A deleted school is not found (soft delete).
    const schools = await this.schools.find({
      where: {
        congregationId,
        startDate: LessThanOrEqual(to),
        endDate: MoreThanOrEqual(from),
      },
    });
    if (schools.length > 0) {
      const days = await this.schoolDays.find({
        where: { congregationId, schoolId: In(schools.map((s) => s.id)) },
      });
      const byId = new Map(schools.map((s) => [s.id, s]));
      for (const d of days) {
        const date = d.date.slice(0, 10);
        if (date < from || date > to) continue;
        const s = byId.get(d.schoolId);
        if (!s) continue;
        out.push({
          date,
          kind: 'pioneer_school',
          eventType: null,
          title: s.title,
          place: s.hallName?.trim() || s.hallAddress?.trim() || null,
          startTime: d.startTime ?? s.startTime ?? null,
          endTime: d.endTime ?? s.endTime ?? null,
          hard: false,
        });
      }
    }

    return out.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    );
  }

  /** The soft ones only, by day — what the preparation should mention. */
  async softByDay(
    congregationId: string,
    from: string,
    to: string,
  ): Promise<Map<string, HallBusy[]>> {
    const map = new Map<string, HallBusy[]>();
    for (const b of await this.between(congregationId, from, to)) {
      if (b.hard) continue;
      const list = map.get(b.date) ?? [];
      list.push(b);
      map.set(b.date, list);
    }
    return map;
  }
}
