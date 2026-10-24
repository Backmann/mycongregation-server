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
  ReplaceFieldServiceTemplateDto,
  TemplateSlotDto,
  UpdateFieldServiceSettingsDto,
} from './dto/field-service-template.dto';
import { mondayOf } from '../common/week';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { refusal } from '../common/errors/refusal';

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
  isGeneral: boolean;
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
        refusal(
          'FS_SLOT_NO_OCCURRENCE',
          'A template slot must say which occurrences of the weekday it means.',
        ),
      );
    }
    const serviceGroupId = s.serviceGroupId ?? null;
    if (serviceGroupId && !groups.has(serviceGroupId)) {
      throw new BadRequestException(
        refusal('NO_SUCH_GROUP', 'No such service group in this congregation.'),
      );
    }
    // Three kinds: a group's own; the congregation's (general); the groups
    // each on their own (no group, not general). An app that says nothing
    // means the general one — that is what a group-less slot always was.
    const isGeneral = serviceGroupId ? false : (s.isGeneral ?? true);
    const address = s.address?.trim() ? s.address.trim() : null;
    if (!address && isGeneral) {
      throw new BadRequestException(
        refusal(
          'FS_GENERAL_NEEDS_ADDRESS',
          'A meeting for the whole congregation must say where it is held.',
        ),
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
      isGeneral,
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
    // A removed group's rows are the congregation's still (24 October 2026):
    // they sleep while it is removed and wake if it is restored. Refusing
    // them made the whole template unsavable the day a group was removed —
    // the app sends every row back, the removed group's among them.
    const groups = new Map(
      (
        await this.groupsRepo.find({
          where: { congregationId },
          withDeleted: true,
        })
      ).map((g) => [g.id, g]),
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
        isGeneral: r.isGeneral,
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
   * The old generator, retired (24 October 2026). It announced meetings at
   * once, ignored assemblies and the circuit overseer's week, and brought
   * back days the overseer had removed. The app stopped calling it on
   * 10 October; a phone that still has the old window hears why instead of
   * a month announced behind the overseer's back. Preparing a month
   * (`prepare`) is the way.
   */
  generate(): never {
    throw new BadRequestException(
      refusal(
        'FS_GENERATE_RETIRED',
        'Generating meetings this way is retired. Prepare the month from the template instead.',
      ),
    );
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

  /** Load groups once for a run. `withRemoved` adds the removed ones. */
  async groupsOf(
    congregationId: string,
    withRemoved = false,
  ): Promise<Map<string, ServiceGroup>> {
    return new Map(
      (
        await this.groupsRepo.find({
          where: { congregationId },
          withDeleted: withRemoved,
        })
      ).map((g) => [g.id, g]),
    );
  }
}
