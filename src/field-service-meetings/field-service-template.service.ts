import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import {
  GenerateFieldServiceDto,
  ReplaceFieldServiceTemplateDto,
} from './dto/field-service-template.dto';
import { mondayOf } from '../common/week';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';

/** UTC 'YYYY-MM-DD'. */
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Date of the Nth occurrence (1-5) of an ISO weekday (1=Mon..7=Sun) in a given
 * month, or null when that occurrence doesn't exist (e.g. a 5th Saturday).
 */
function nthWeekdayOfMonth(
  year: number,
  month: number, // 1-12
  isoDow: number, // 1=Mon..7=Sun
  ordinal: number,
): Date | null {
  const jsTarget = isoDow === 7 ? 0 : isoDow; // JS: 0=Sun..6=Sat
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  let day = 1 + ((jsTarget - firstDow + 7) % 7) + (ordinal - 1) * 7;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? date : null;
}

@Injectable()
export class FieldServiceTemplateService {
  constructor(
    @InjectRepository(FieldServiceTemplateSlot)
    private readonly slotRepo: Repository<FieldServiceTemplateSlot>,
    @InjectRepository(FieldServiceMeeting)
    private readonly meetingRepo: Repository<FieldServiceMeeting>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
  ) {}

  getSlots(congregationId: string): Promise<FieldServiceTemplateSlot[]> {
    return this.slotRepo.find({
      where: { congregationId },
      order: { position: 'ASC' },
    });
  }

  /**
   * Replace the template wholesale.
   *
   * The old rows are gone the moment this runs — there is no version of a
   * template, and keeping the discarded rows around would leave a table full
   * of hidden clutter with no way to tell which set was in force. So the
   * PREVIOUS template goes into the change journal instead: a person who
   * saved over the wrong thing can read what stood there and type it back.
   * Without that, «сохранить» quietly took the schedule with it.
   */
  async replaceSlots(
    congregationId: string,
    dto: ReplaceFieldServiceTemplateDto,
  ): Promise<FieldServiceTemplateSlot[]> {
    const before = await this.getSlots(congregationId);
    // Delete and insert as ONE step. Apart, a failed insert (a bad row, a
    // dropped connection) left the congregation with no template at all —
    // the old one already gone, the new one never written.
    await this.slotRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(FieldServiceTemplateSlot);
      await repo.delete({ congregationId });
      if (dto.slots.length) {
        const rows = dto.slots.map((s, i) =>
          repo.create({
            congregationId,
            position: i,
            ordinal: s.ordinal,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            address: s.address,
          }),
        );
        await repo.save(rows);
      }
    });
    const after = await this.getSlots(congregationId);
    const shape = (rows: FieldServiceTemplateSlot[]) =>
      rows.map((r) => ({
        ordinal: r.ordinal,
        dayOfWeek: r.dayOfWeek,
        startTime: r.startTime,
        address: r.address,
      }));
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'field_service_template',
      entityId: congregationId,
      before: { slots: JSON.stringify(shape(before)) },
      after: { slots: JSON.stringify(shape(after)) },
      fields: ['slots'],
    });
    return after;
  }

  /**
   * Materialize the template into real meetings across the chosen month range.
   * Conductor/topic are left empty. Safe to re-run / extend:
   *
   *  • A day already gone is not filled (`past`). The month being lived is the
   *    month most often generated, and its first Saturdays are behind it —
   *    they came back as fresh, empty meetings on days nobody could hold them
   *    any more (9 October 2026). The day is the congregation's; today is
   *    still open.
   *  • A meeting already on that DAY at the same time, OR at the same place,
   *    counts as the slot being there (`skipped`). Until 9 October 2026 only
   *    the exact time counted: move the third Saturday from 10:30 to 10:00 by
   *    hand, run the month again, and a second, empty 10:30 meeting appeared
   *    beside it. A group's own meeting that day — another time AND another
   *    place — does not stand in for the template's and does not block it.
   *
   * The whole run is ONE line in the journal (how many, which weeks), as the
   * bulk creation of assignments already is: until now generating a month
   * left no trace at all.
   */
  async generate(
    congregationId: string,
    dto: GenerateFieldServiceDto,
  ): Promise<{ created: number; skipped: number; past: number }> {
    const slots = await this.getSlots(congregationId);
    if (!slots.length) return { created: 0, skipped: 0, past: 0 };
    const today = await this.clock.todayFor(congregationId);

    const specs: {
      weekStartDate: string;
      dayOfWeek: number;
      startTime: string;
      address: string;
    }[] = [];
    let past = 0;
    let y = dto.startYear;
    let m = dto.startMonth;
    for (let i = 0; i < dto.months; i++) {
      for (const slot of slots) {
        const date = nthWeekdayOfMonth(y, m, slot.dayOfWeek, slot.ordinal);
        if (!date) continue;
        if (toISO(date) < today) {
          past += 1;
          continue;
        }
        specs.push({
          weekStartDate: mondayOf(toISO(date)),
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          address: slot.address,
        });
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    if (!specs.length) return { created: 0, skipped: 0, past };

    const weekStarts = specs.map((s) => s.weekStartDate).sort();
    const existing = await this.meetingRepo.find({
      where: {
        congregationId,
        weekStartDate: Between(
          weekStarts[0],
          weekStarts[weekStarts.length - 1],
        ),
      },
    });
    const day = (m: { weekStartDate: string; dayOfWeek: number }) =>
      `${m.weekStartDate}|${m.dayOfWeek}`;
    const place = (a: string) => a.trim().toLowerCase();
    // What already stands on each day: its times and its places. A meeting
    // made in this very run joins them, so a template with two slots on one
    // day at one time still yields one meeting.
    const onDay = new Map<
      string,
      { times: Set<string>; places: Set<string> }
    >();
    const note = (m: {
      weekStartDate: string;
      dayOfWeek: number;
      startTime: string;
      address: string;
    }) => {
      const k = day(m);
      const d = onDay.get(k) ?? { times: new Set(), places: new Set() };
      d.times.add(m.startTime);
      d.places.add(place(m.address));
      onDay.set(k, d);
    };
    existing.forEach(note);

    let created = 0;
    let skipped = 0;
    const toInsert: FieldServiceMeeting[] = [];
    for (const s of specs) {
      const d = onDay.get(day(s));
      if (d && (d.times.has(s.startTime) || d.places.has(place(s.address)))) {
        skipped += 1;
        continue;
      }
      note(s);
      toInsert.push(
        this.meetingRepo.create({
          congregationId,
          weekStartDate: s.weekStartDate,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          address: s.address,
          conductorPublisherId: null,
          topic: null,
          sourceUrl: null,
          isGeneral: false,
        }),
      );
      created += 1;
    }
    if (toInsert.length) {
      const saved = await this.meetingRepo.save(toInsert);
      await this.auditLog.logEvent({
        tenantId: congregationId,
        entityType: 'field_service_meeting',
        entityId: saved[0]?.id ?? congregationId,
        action: 'CREATE' as never,
        detail: {
          bulk: true,
          count: saved.length,
          weeks: [...new Set(saved.map((x) => x.weekStartDate))].sort(),
          fromTemplate: true,
        },
      });
    }
    return { created, skipped, past };
  }
}
