import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import {
  GenerateFieldServiceDto,
  ReplaceFieldServiceTemplateDto,
} from './dto/field-service-template.dto';

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

/** Monday (UTC) of the ISO week containing the date. */
function mondayOf(d: Date): Date {
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() + diff);
  return m;
}

@Injectable()
export class FieldServiceTemplateService {
  constructor(
    @InjectRepository(FieldServiceTemplateSlot)
    private readonly slotRepo: Repository<FieldServiceTemplateSlot>,
    @InjectRepository(FieldServiceMeeting)
    private readonly meetingRepo: Repository<FieldServiceMeeting>,
  ) {}

  getSlots(congregationId: string): Promise<FieldServiceTemplateSlot[]> {
    return this.slotRepo.find({
      where: { congregationId },
      order: { position: 'ASC' },
    });
  }

  async replaceSlots(
    congregationId: string,
    dto: ReplaceFieldServiceTemplateDto,
  ): Promise<FieldServiceTemplateSlot[]> {
    await this.slotRepo.delete({ congregationId });
    if (dto.slots.length) {
      const rows = dto.slots.map((s, i) =>
        this.slotRepo.create({
          congregationId,
          position: i,
          ordinal: s.ordinal,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          address: s.address,
        }),
      );
      await this.slotRepo.save(rows);
    }
    return this.getSlots(congregationId);
  }

  /**
   * Materialize the template into real meetings across the chosen month range.
   * Conductor/topic are left empty. Existing meetings on the same
   * week+weekday+time are left untouched (idempotent, safe to re-run / extend).
   */
  async generate(
    congregationId: string,
    dto: GenerateFieldServiceDto,
  ): Promise<{ created: number; skipped: number }> {
    const slots = await this.getSlots(congregationId);
    if (!slots.length) return { created: 0, skipped: 0 };

    const specs: {
      weekStartDate: string;
      dayOfWeek: number;
      startTime: string;
      address: string;
    }[] = [];
    let y = dto.startYear;
    let m = dto.startMonth;
    for (let i = 0; i < dto.months; i++) {
      for (const slot of slots) {
        const date = nthWeekdayOfMonth(y, m, slot.dayOfWeek, slot.ordinal);
        if (!date) continue;
        specs.push({
          weekStartDate: toISO(mondayOf(date)),
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
    if (!specs.length) return { created: 0, skipped: 0 };

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
    const seen = new Set(
      existing.map((e) => `${e.weekStartDate}|${e.dayOfWeek}|${e.startTime}`),
    );

    let created = 0;
    let skipped = 0;
    const toInsert: FieldServiceMeeting[] = [];
    for (const s of specs) {
      const key = `${s.weekStartDate}|${s.dayOfWeek}|${s.startTime}`;
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
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
    if (toInsert.length) await this.meetingRepo.save(toInsert);
    return { created, skipped };
  }
}
