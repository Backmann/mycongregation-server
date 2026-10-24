import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Absence } from '../entities/absence.entity';
import { FieldServicePlannerService } from './field-service-planner.service';

/**
 * What has gone wrong with a meeting since it was planned (24 October 2026).
 *
 * The planner looked at absences, the card switch and the calendar only
 * while it picked; a vacation entered a week later, a switch turned off, a
 * brother removed, a group removed, an assembly entered afterwards — none of
 * it reached the month that was already made, and the night's
 * auto-publication told the brother «you conduct» for a day he is away
 * (sync audit M1, L5–L7). The same reading now marks the month view,
 * holds such a draft back from auto-publication, and fills the morning
 * check.
 */
export type MeetingProblem =
  /** The conductor is away that day. */
  | 'conductor_absent'
  /** The conductor no longer conducts: card switch off, or not active. */
  | 'conductor_not_conductor'
  /** The conductor's card was removed. */
  | 'conductor_removed'
  /** The meeting's group was removed. */
  | 'group_removed'
  /** An assembly or a convention takes the day. */
  | 'assembly'
  /** The circuit overseer's week: its own schedule holds. */
  | 'co_visit';

/** The problems that stop a draft being announced on its own. */
export const HOLDS_PUBLICATION: readonly MeetingProblem[] = [
  'conductor_absent',
  'conductor_not_conductor',
  'conductor_removed',
  'group_removed',
  'assembly',
  'co_visit',
];

export interface MeetingAttention {
  problems: MeetingProblem[];
  /** The conductor's name, for the words of a message. */
  conductorName: string | null;
  /** The event that takes the day, for the words. */
  because: string | null;
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function meetingDay(m: {
  weekStartDate: string;
  dayOfWeek: number;
}): string {
  return addDaysISO(String(m.weekStartDate).slice(0, 10), m.dayOfWeek - 1);
}

@Injectable()
export class FieldServiceAttentionService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(ServiceGroup)
    private readonly groups: Repository<ServiceGroup>,
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    private readonly planner: FieldServicePlannerService,
  ) {}

  /**
   * Each meeting's problems, by id. A meeting called off has none: it is
   * not held. Days already gone are not judged either.
   */
  async of(
    congregationId: string,
    meetings: FieldServiceMeeting[],
    today: string,
  ): Promise<Map<string, MeetingAttention>> {
    const out = new Map<string, MeetingAttention>();
    const live = meetings.filter(
      (m) => !m.cancelledAt && meetingDay(m) >= today,
    );
    if (live.length === 0) return out;

    const pids = [
      ...new Set(
        live.map((m) => m.conductorPublisherId).filter((x): x is string => !!x),
      ),
    ];
    const people = new Map(
      (pids.length
        ? await this.publishers.find({
            where: { congregationId, id: In(pids) },
            withDeleted: true,
          })
        : []
      ).map((p) => [p.id, p]),
    );
    const gids = [
      ...new Set(
        live.map((m) => m.serviceGroupId).filter((x): x is string => !!x),
      ),
    ];
    const groups = new Map(
      (gids.length
        ? await this.groups.find({
            where: { congregationId, id: In(gids) },
            withDeleted: true,
          })
        : []
      ).map((g) => [g.id, g]),
    );
    const days = live.map(meetingDay).sort();
    const away = pids.length
      ? (
          await this.absences.find({
            where: {
              congregationId,
              publisherId: In(pids),
              startDate: LessThanOrEqual(days[days.length - 1]),
            },
          })
        ).filter((a) => (a.endDate ?? a.startDate) >= days[0])
      : [];
    const isAway = (pid: string, d: string) =>
      away.some(
        (a) =>
          a.publisherId === pid &&
          String(a.startDate).slice(0, 10) <= d &&
          d <= String(a.endDate ?? a.startDate).slice(0, 10),
      );
    const taken = new Map<
      string,
      Awaited<ReturnType<FieldServicePlannerService['dayTaken']>>
    >();
    for (const d of new Set(days)) {
      taken.set(d, await this.planner.dayTaken(congregationId, d));
    }

    for (const m of live) {
      const d = meetingDay(m);
      const problems: MeetingProblem[] = [];
      const p = m.conductorPublisherId
        ? people.get(m.conductorPublisherId)
        : undefined;
      if (m.conductorPublisherId) {
        // The service overseer conducting his own visit is held to his
        // appointment, not to the switch — as saving the meeting is.
        const ownVisit =
          m.serviceOverseerVisit &&
          m.conductorPublisherId === m.serviceOverseerPublisherId;
        if (!p || p.deletedAt) problems.push('conductor_removed');
        else if (
          !ownVisit &&
          (!p.isActive || p.capabilities?.fs_meeting_conductor !== true)
        )
          problems.push('conductor_not_conductor');
        if (p && !p.deletedAt && isAway(p.id, d))
          problems.push('conductor_absent');
      }
      if (m.serviceGroupId) {
        const g = groups.get(m.serviceGroupId);
        if (!g || g.deletedAt) problems.push('group_removed');
      }
      const t = taken.get(d);
      if (t) problems.push(t.kind);
      if (problems.length === 0) continue;
      out.set(m.id, {
        problems,
        conductorName: p
          ? p.displayName || `${p.lastName} ${p.firstName}`.trim()
          : null,
        because: t?.title ?? null,
      });
    }
    return out;
  }
}
