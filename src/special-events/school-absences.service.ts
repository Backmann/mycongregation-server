import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Absence } from '../entities/absence.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { InvitationsService } from './invitations.service';

/**
 * THE KINGDOM MINISTRY SCHOOL MARKS ITS BROTHERS AWAY (19 November 2026,
 * Lionel: «обычно это встреча идёт целый день, поэтому нужно отметить
 * отсутствие для брата»).
 *
 * Before, the invited were only «busy» in the person picker; everything else
 * that reads absences — the field service plan, the duties' autofill, the
 * reminders, the warnings about a clash — did not know, and a brother at the
 * school was shown leading the field service meeting of that morning.
 *
 * Now each invited brother has one absence over the school's days, linked to
 * the event (`specialEventId`). It is the event's own bookkeeping, as the
 * pioneer school's and a trip's are: written and withdrawn here, never by
 * hand. Who is invited is the rule of invitations.ts, read on the day.
 *
 * An event that is over is history: its absences stay as they were.
 */
export const ABSENT_EVENT_TYPES: readonly string[] = [
  'kingdom_ministry_school_elders',
  'kingdom_ministry_school_servants',
];

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

@Injectable()
export class SchoolAbsencesService {
  private readonly logger = new Logger(SchoolAbsencesService.name);

  constructor(
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    private readonly invitations: InvitationsService,
    private readonly clock: CongregationClock,
  ) {}

  /**
   * Brings one event's absences in line with it. Best effort: whatever saved
   * the event has saved it, and the night's pass puts a failure right.
   */
  async follow(eventId: string): Promise<void> {
    try {
      await this.sync(eventId);
    } catch (err) {
      this.logger.warn(
        `event ${eventId}: absences not brought in line: ${(err as Error).message}`,
      );
    }
  }

  /** Every school still to come, once a night: appointments change. */
  async resyncUpcoming(): Promise<number> {
    const rows = await this.events.find({
      where: { type: In([...ABSENT_EVENT_TYPES]) },
      select: { id: true },
      withDeleted: true,
    });
    // Rows whose event is no longer a school (its kind was changed).
    const stray = await this.absences
      .createQueryBuilder('a')
      .withDeleted()
      .select('DISTINCT a.special_event_id', 'id')
      .where('a.special_event_id IS NOT NULL')
      .getRawMany<{ id: string }>();
    const ids = new Set([...rows.map((r) => r.id), ...stray.map((r) => r.id)]);
    let done = 0;
    for (const id of ids) {
      try {
        await this.sync(id);
        done += 1;
      } catch (err) {
        this.logger.warn(`event ${id}: ${(err as Error).message}`);
      }
    }
    return done;
  }

  /** Exposed for the tests; `follow` is the door the app uses. */
  async sync(eventId: string): Promise<void> {
    const event = await this.events.findOne({
      where: { id: eventId },
      withDeleted: true,
    });
    const existing = await this.absences.find({
      where: { specialEventId: eventId },
      withDeleted: true,
    });
    if (!event) {
      if (existing.length)
        await this.absences.delete({ specialEventId: eventId });
      return;
    }
    const today = await this.clock.todayFor(event.congregationId);
    const from = day(event.date)!;
    const to = day(event.endDate) ?? from;
    // History: a school that is over keeps the absences it had.
    if (to < today) return;

    const wanted = new Map<string, true>();
    if (!event.deletedAt && ABSENT_EVENT_TYPES.includes(event.type ?? '')) {
      for (const p of await this.invitations.invitedPublishers(event)) {
        wanted.set(p.id, true);
      }
    }

    for (const row of existing) {
      const fits =
        wanted.has(row.publisherId) &&
        row.congregationId === event.congregationId &&
        day(row.startDate) === from &&
        (day(row.endDate) ?? day(row.startDate)) === to;
      if (fits) {
        if (row.deletedAt) await this.absences.restore(row.id);
        wanted.delete(row.publisherId);
        continue;
      }
      // Moved, uninvited or the school gone: the absence goes with it.
      await this.absences.delete(row.id);
    }

    for (const publisherId of wanted.keys()) {
      await this.absences.save(
        this.absences.create({
          congregationId: event.congregationId,
          publisherId,
          startDate: from,
          endDate: to === from ? null : to,
          // No words of its own: the event says why, in the reader's
          // language (as the pioneer school's absences, 23 October).
          note: null,
          specialEventId: event.id,
        }),
      );
    }
  }

  /** The kinds of the events these absences come from, for their labels. */
  async typesOf(eventIds: string[]): Promise<Map<string, string | null>> {
    if (!eventIds.length) return new Map();
    const rows = await this.events.find({
      where: { id: In(eventIds) },
      select: { id: true, type: true },
      withDeleted: true,
    });
    return new Map(rows.map((e) => [e.id, e.type]));
  }
}
