import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  FieldServiceTemplateSlot,
  type ConductorRule,
} from '../entities/field-service-template-slot.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { FieldServiceSettings } from '../entities/field-service-settings.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import {
  GenerateFieldServiceDto,
  ReplaceFieldServiceTemplateDto,
  TemplateSlotDto,
  UpdateFieldServiceSettingsDto,
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
export function nthWeekdayOfMonth(
  year: number,
  month: number, // 1-12
  isoDow: number, // 1=Mon..7=Sun
  ordinal: number,
): Date | null {
  const jsTarget = isoDow === 7 ? 0 : isoDow; // JS: 0=Sun..6=Sat
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  const day = 1 + ((jsTarget - firstDow + 7) % 7) + (ordinal - 1) * 7;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? date : null;
}

/** The last occurrence of the weekday in the month: the 5th if there is one,
 * else the 4th. */
export function lastWeekdayOfMonth(
  year: number,
  month: number,
  isoDow: number,
): Date {
  return (
    nthWeekdayOfMonth(year, month, isoDow, 5) ??
    nthWeekdayOfMonth(year, month, isoDow, 4)!
  );
}

/**
 * Every date a slot lands on in a month, ascending and without doubles —
 * «every», «the last» and «the 1st and 3rd» answered the same way.
 */
export function slotDatesInMonth(
  slot: Pick<FieldServiceTemplateSlot, 'lastOnly' | 'dayOfWeek'> &
    Partial<Pick<FieldServiceTemplateSlot, 'ordinal' | 'ordinals'>>,
  year: number,
  month: number,
): string[] {
  const out = new Set<string>();
  // A row the migration has not touched (or a test's) still has its one
  // ordinal; it means exactly that one.
  const ordinals = slot.ordinals?.length
    ? slot.ordinals
    : slot.ordinal
      ? [slot.ordinal]
      : [];
  for (const n of ordinals) {
    const d = nthWeekdayOfMonth(year, month, slot.dayOfWeek, n);
    if (d) out.add(toISO(d));
  }
  if (slot.lastOnly) {
    out.add(toISO(lastWeekdayOfMonth(year, month, slot.dayOfWeek)));
  }
  return [...out].sort();
}

/** The slot as the app reads it, in both shapes at once. */
export interface TemplateSlotView {
  id: string;
  position: number;
  ordinal: number;
  ordinals: number[];
  lastOnly: boolean;
  dayOfWeek: number;
  startTime: string;
  address: string | null;
  serviceGroupId: string | null;
  conductorRule: ConductorRule;
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
    @InjectRepository(FieldServiceSettings)
    private readonly settingsRepo: Repository<FieldServiceSettings>,
    @InjectRepository(ServiceGroup)
    private readonly groupsRepo: Repository<ServiceGroup>,
  ) {}

  getSlots(congregationId: string): Promise<FieldServiceTemplateSlot[]> {
    return this.slotRepo.find({
      where: { congregationId },
      order: { position: 'ASC' },
    });
  }

  /**
   * One slot from either shape of the request — see TemplateSlotDto.
   *
   * What is refused, in words: a slot that lands on no day at all; a general
   * meeting with nowhere to meet; a group that is not this congregation's.
   */
  private normalize(
    s: TemplateSlotDto,
    groups: Map<string, ServiceGroup>,
  ): Omit<TemplateSlotView, 'id' | 'position'> {
    const ordinals = [
      ...new Set(
        s.ordinals && s.ordinals.length
          ? s.ordinals
          : s.ordinal
            ? [s.ordinal]
            : [],
      ),
    ].sort();
    const lastOnly = s.lastOnly === true;
    if (ordinals.length === 0 && !lastOnly) {
      throw new BadRequestException(
        'A template slot must say which occurrences of the weekday it means.',
      );
    }
    const serviceGroupId = s.serviceGroupId ?? null;
    if (serviceGroupId && !groups.has(serviceGroupId)) {
      throw new BadRequestException(
        'No such service group in this congregation.',
      );
    }
    const address = s.address?.trim() ? s.address.trim() : null;
    if (!address && !serviceGroupId) {
      throw new BadRequestException(
        'A meeting for the whole congregation must say where it is held.',
      );
    }
    return {
      // The old shape's one number: the first of the new ones, or «the last»
      // written as the 5th — the nearest the old shape can say.
      ordinal: ordinals[0] ?? 5,
      ordinals,
      lastOnly,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      address,
      serviceGroupId,
      conductorRule: s.conductorRule ?? 'none',
    };
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
    const groups = new Map(
      (await this.groupsRepo.find({ where: { congregationId } })).map((g) => [
        g.id,
        g,
      ]),
    );
    const rows: Omit<TemplateSlotView, 'id' | 'position'>[] = [];
    for (const s of dto.slots) rows.push(this.normalize(s, groups));
    const before = await this.getSlots(congregationId);
    // Delete and insert as ONE step. Apart, a failed insert (a bad row, a
    // dropped connection) left the congregation with no template at all —
    // the old one already gone, the new one never written.
    await this.slotRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(FieldServiceTemplateSlot);
      await repo.delete({ congregationId });
      if (rows.length) {
        await repo.save(
          rows.map((r, i) =>
            repo.create({ congregationId, position: i, ...r }),
          ),
        );
      }
    });
    const after = await this.getSlots(congregationId);
    const shape = (list: FieldServiceTemplateSlot[]) =>
      list.map((r) => ({
        ordinals: r.ordinals,
        lastOnly: r.lastOnly,
        dayOfWeek: r.dayOfWeek,
        startTime: r.startTime,
        address: r.address,
        serviceGroupId: r.serviceGroupId,
        conductorRule: r.conductorRule,
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

  /** The congregation's row, made with the defaults on first read. */
  async getSettings(congregationId: string): Promise<FieldServiceSettings> {
    const found = await this.settingsRepo.findOne({
      where: { congregationId },
    });
    if (found) return found;
    return this.settingsRepo.save(this.settingsRepo.create({ congregationId }));
  }

  async updateSettings(
    congregationId: string,
    dto: UpdateFieldServiceSettingsDto,
  ): Promise<FieldServiceSettings> {
    const cur = await this.getSettings(congregationId);
    const fields = [
      'skipAssemblies',
      'coVisitFromSchedule',
      'autoPrepare',
      'prepareLead',
      'autoPickConductors',
      'unpublishedPolicy',
    ] as const;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const f of fields) {
      before[f] = cur[f];
      const v = dto[f];
      if (v !== undefined) (cur as unknown as Record<string, unknown>)[f] = v;
      after[f] = cur[f];
    }
    const saved = await this.settingsRepo.save(cur);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'field_service_settings',
      entityId: congregationId,
      before,
      after,
      fields: [...fields],
    });
    return saved;
  }

  /**
   * Where a slot's meeting is held: what the slot says, else the group's own
   * place, else nothing (a group with no place written yet).
   */
  static placeOf(
    slot: Pick<FieldServiceTemplateSlot, 'address' | 'serviceGroupId'>,
    groups: Map<string, ServiceGroup>,
  ): string {
    if (slot.address) return slot.address;
    const g = slot.serviceGroupId ? groups.get(slot.serviceGroupId) : null;
    return g?.meetingLocation?.trim() ?? '';
  }

  /**
   * Materialize the template into real meetings across the chosen month range
   * — the generator the app has called since the template existed. Announced
   * at once, conductor left empty: the app that calls this shows the month
   * the moment it returns and knows nothing of drafts. The new way (a draft
   * month, conductors picked, the calendar honoured) is `prepare` in the
   * planner. Safe to re-run / extend:
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
    const groups = new Map(
      (await this.groupsRepo.find({ where: { congregationId } })).map((g) => [
        g.id,
        g,
      ]),
    );

    const specs: {
      weekStartDate: string;
      dayOfWeek: number;
      startTime: string;
      address: string;
      serviceGroupId: string | null;
    }[] = [];
    let past = 0;
    let y = dto.startYear;
    let m = dto.startMonth;
    for (let i = 0; i < dto.months; i++) {
      for (const slot of slots) {
        for (const iso of slotDatesInMonth(slot, y, m)) {
          if (iso < today) {
            past += 1;
            continue;
          }
          specs.push({
            weekStartDate: mondayOf(iso),
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            address: FieldServiceTemplateService.placeOf(slot, groups),
            serviceGroupId: slot.serviceGroupId,
          });
        }
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
          serviceGroupId: s.serviceGroupId,
          // The old generator announces at once, as it always did: the app
          // that calls it shows the month the moment it returns.
          publishedAt: new Date(),
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

  /** Meetings of one calendar month, by their own day, drafts included. */
  async meetingsOfMonth(
    congregationId: string,
    year: number,
    month: number,
  ): Promise<FieldServiceMeeting[]> {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const next =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const rows = await this.meetingRepo.find({
      where: {
        congregationId,
        weekStartDate: Between(mondayOf(first), next),
      },
      order: { weekStartDate: 'ASC', dayOfWeek: 'ASC', startTime: 'ASC' },
    });
    return rows.filter((m) => {
      const d = new Date(`${m.weekStartDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + m.dayOfWeek - 1);
      const iso = toISO(d);
      return iso >= first && iso < next;
    });
  }

  /** Load groups once for a run. */
  async groupsOf(congregationId: string): Promise<Map<string, ServiceGroup>> {
    return new Map(
      (await this.groupsRepo.find({ where: { congregationId } })).map((g) => [
        g.id,
        g,
      ]),
    );
  }
}
