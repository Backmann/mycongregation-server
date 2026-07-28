import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { ServiceGroup } from '../entities/service-group.entity';

export interface GroupVisitRow {
  serviceGroupId: string;
  name: string;
  /** Visits inside the service year asked about. */
  visitsThisYear: number;
  /** The most recent visit that has already happened, of any year. */
  lastVisitDate: string | null;
  lastVisitBy: string | null;
  /** The next visit already planned, if there is one. */
  nextVisitDate: string | null;
}

/**
 * The service overseer visits every field-service group at least once a
 * service year, sometimes more.
 *
 * What this answers is deliberately NOT "list the visits" but "which groups
 * still need one". A visit log is something people open in August and discover
 * two groups were missed; a list of groups with the answer beside each is
 * something that can be acted on in March. The talk coordinator's speaker
 * rotation is the same shape and it works there.
 *
 * A visit is a MARK ON A MEETING rather than a record of its own — he conducts
 * the meeting and preaches with the group on one occasion — so everything here
 * is derived from meetings, and nothing can disagree with the schedule.
 */
@Injectable()
export class ServiceOverseerService {
  constructor(
    @InjectRepository(FieldServiceMeeting)
    private readonly meetings: Repository<FieldServiceMeeting>,
    @InjectRepository(ServiceGroup)
    private readonly groups: Repository<ServiceGroup>,
  ) {}

  async groupVisits(
    congregationId: string,
    serviceYear: number,
    today: string,
  ): Promise<{ serviceYear: number; groups: GroupVisitRow[] }> {
    const [groups, visits] = await Promise.all([
      this.groups.find({
        where: { congregationId },
        order: { name: 'ASC' },
      }),
      this.meetings.find({
        where: { congregationId, serviceOverseerVisit: true },
      }),
    ]);

    const bounds = serviceYearBounds(serviceYear);
    const byGroup = new Map<string, GroupVisitRow>();
    for (const g of groups) {
      byGroup.set(g.id, {
        serviceGroupId: g.id,
        name: g.name,
        visitsThisYear: 0,
        lastVisitDate: null,
        lastVisitBy: null,
        nextVisitDate: null,
      });
    }

    for (const m of visits) {
      if (!m.serviceGroupId) continue;
      const row = byGroup.get(m.serviceGroupId);
      // A visit whose group has since been disbanded is not attributed to
      // anyone. The link is cleared on delete, so this is belt and braces.
      if (!row) continue;

      const date = meetingDate(m.weekStartDate, m.dayOfWeek);
      if (date >= bounds.first && date <= bounds.last) {
        row.visitsThisYear += 1;
      }
      if (date <= today) {
        if (!row.lastVisitDate || date > row.lastVisitDate) {
          row.lastVisitDate = date;
          row.lastVisitBy = m.serviceOverseerPublisherId;
        }
      } else if (!row.nextVisitDate || date < row.nextVisitDate) {
        row.nextVisitDate = date;
      }
    }

    /**
     * Longest without a visit first, and a group never visited at all before
     * any of them — that is the one most easily forgotten, since it has no
     * date to catch the eye. Groups already visited this year sink to the
     * bottom without being hidden: a second visit is allowed, just not urgent.
     */
    const rows = [...byGroup.values()].sort((a, b) => {
      if (a.visitsThisYear !== b.visitsThisYear) {
        return a.visitsThisYear - b.visitsThisYear;
      }
      if (a.lastVisitDate === b.lastVisitDate)
        return a.name.localeCompare(b.name);
      if (!a.lastVisitDate) return -1;
      if (!b.lastVisitDate) return 1;
      return a.lastVisitDate.localeCompare(b.lastVisitDate);
    });

    return { serviceYear, groups: rows };
  }
}

/** September through August, the year the app already counts by. */
export function serviceYearBounds(serviceYear: number): {
  first: string;
  last: string;
} {
  return { first: `${serviceYear - 1}-09-01`, last: `${serviceYear}-08-31` };
}

/**
 * The real date of a meeting, which is not stored: a meeting is keyed by the
 * Monday of its week plus a day of the week, so that a week can be moved
 * without rewriting every row.
 */
export function meetingDate(weekStartDate: string, dayOfWeek: number): string {
  const d = new Date(`${weekStartDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (dayOfWeek - 1));
  return d.toISOString().slice(0, 10);
}
