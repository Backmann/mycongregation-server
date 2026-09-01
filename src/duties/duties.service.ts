import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InjectRepository } from '@nestjs/typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { LessThan, LessThanOrEqual, Not, Repository } from 'typeorm';
import { Duty } from '../entities/duty.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { EventType } from '../common/enums/event-type.enum';
import {
  DutyType,
  SINGLE_SLOT_DUTIES_AFTER_MIC,
  MEMORIAL_DUTIES,
  SINGLE_SLOT_DUTIES_BEFORE_MIC,
} from '../common/enums/duty-type.enum';
import { QueryDutiesDto } from './dto/query-duties.dto';
import { GenerateWeekDutiesDto } from './dto/generate-week-duties.dto';
import { AssignDutyDto } from './dto/assign-duty.dto';
import { CreateCustomDutyDto } from './dto/create-custom-duty.dto';
import { CongregationClock } from '../common/congregation-clock.service';
import { MeetingKind, weekRules, WeekRules } from '../common/week-rules';

/**
 * Non-blocking conflict warning codes returned when a publisher is assigned to
 * a duty. The app localizes these; the assignment is always allowed.
 */
export type DutyWarning =
  | 'already_on_duty' // already holds another duty in the same meeting
  | 'has_program_part' // has a program part assignment in the same meeting
  | 'capability_off'; // the duty_<type> capability is not enabled

export interface DutyWithWarnings {
  duty: Duty;
  warnings: DutyWarning[];
}

export interface MicRuleWarning {
  code: 'mic_taken' | 'mic_capability_off';
  publisherName: string;
}

@Injectable()
export class DutiesService {
  constructor(
    private readonly auditLog: AuditLogService,
    @InjectRepository(Duty)
    private readonly repo: Repository<Duty>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Publisher)
    private readonly publisherRepo: Repository<Publisher>,
    @InjectRepository(MeetingSettings)
    private readonly meetingRepo: Repository<MeetingSettings>,
    @InjectRepository(Congregation)
    private readonly congregationRepo: Repository<Congregation>,
    @InjectRepository(SpecialEvent)
    private readonly specialEventRepo: Repository<SpecialEvent>,
    private readonly clock: CongregationClock,
  ) {}

  /**
   * Duties of a meeting that has already taken place are history and must stay
   * untouched: they freeze at midnight following the meeting's own day, so the
   * meeting stays editable right through it. The day comes from the settings
   * version in force for that week, and a circuit-overseer visit that moves the
   * midweek meeting moves the deadline with it.
   */
  /**
   * What that week actually holds, asked of the one authority.
   *
   * This used to be fifteen lines of hand-written rule right here — the FOURTH
   * copy of "which day is the midweek meeting, and does the visit move it". It
   * agreed with the others by luck rather than by construction, and nothing
   * tested it. The rule now lives in common/week-rules.ts, and this only asks.
   *
   * The events are re-tagged with the type they were QUERIED by rather than
   * read off the row: each is fetched by an explicit filter, so the kind is
   * already known, and the rules must not depend on a column a caller might
   * not have selected.
   */
  private async rulesOfWeek(
    congregationId: string,
    weekStartDate: string,
  ): Promise<WeekRules> {
    const versions = await this.meetingRepo.find({
      where: { congregationId },
      order: { effectiveFrom: 'ASC' },
    });
    const visits = await this.specialEventRepo.find({
      where: { congregationId, type: 'circuit_overseer_visit' },
    });
    const cancelling = await this.specialEventRepo.find({
      where: [
        { congregationId, type: 'regional_convention' },
        { congregationId, type: 'circuit_assembly' },
      ],
    });
    const memorials = await this.specialEventRepo.find({
      where: { congregationId, type: 'memorial' },
    });
    const flagged = await this.specialEventRepo.find({
      where: { congregationId, replacesMeeting: true },
    });
    return weekRules({
      weekStart: weekStartDate,
      versions,
      events: [
        ...visits.map((e) => ({ ...e, type: 'circuit_overseer_visit' })),
        ...cancelling.map((e) => ({
          ...e,
          type: e.type ?? 'regional_convention',
        })),
        ...memorials.map((e) => ({ ...e, type: 'memorial' })),
        ...flagged.map((e) => ({ ...e, replacesMeeting: true })),
      ],
    });
  }

  private async assertEditable(
    congregationId: string,
    weekStartDate: string,
    eventType: string,
  ): Promise<void> {
    if (eventType !== 'midweek' && eventType !== 'weekend') return;

    const rules = await this.rulesOfWeek(congregationId, weekStartDate);
    const held = rules.meetings.find((m) => m.kind === eventType);
    // No such meeting that week — a convention, or the Memorial took it. There
    // is nothing to freeze, and editing STAYS ALLOWED on purpose: duties made
    // before the event was entered must remain removable, or a mistake would
    // be locked in forever. Creating new ones is refused separately, in
    // generateWeek.
    if (!held) return;

    if (held.date < (await this.clock.todayFor(congregationId))) {
      // The refusal itself is worth recording: "who tried to change last
      // week's duties" is exactly the question the journal gets asked, and
      // until now every rejection vanished without trace.
      await this.auditLog.logEvent({
        tenantId: congregationId,
        entityType: 'duty',
        entityId: congregationId,
        action: 'DENY',
        detail: { reason: 'past_frozen', weekStartDate, eventType },
      });
      throw new ConflictException(
        'This meeting has already taken place; its duties are part of the record and can no longer be changed.',
      );
    }
  }

  list(congregationId: string, query: QueryDutiesDto): Promise<Duty[]> {
    const qb = this.repo
      .createQueryBuilder('d')
      .where('d.congregationId = :congregationId', { congregationId });
    if (query.weekStart) {
      qb.andWhere('d.weekStartDate >= :weekStart', {
        weekStart: query.weekStart,
      });
    }
    if (query.weekEnd) {
      qb.andWhere('d.weekStartDate < :weekEnd', { weekEnd: query.weekEnd });
    }
    if (query.eventType) {
      qb.andWhere('d.eventType = :eventType', { eventType: query.eventType });
    }
    return (
      qb
        .orderBy('d.weekStartDate', 'ASC')
        .addOrderBy('d.eventType', 'ASC')
        // The place's own position, kept and moved by hand. `dutyType` stays as
        // a tie-break for rows written before the column existed, and `slotIndex`
        // keeps the microphones in their numbered order inside a place.
        .addOrderBy('d.sortOrder', 'ASC')
        .addOrderBy('d.dutyType', 'ASC')
        .addOrderBy('d.slotIndex', 'ASC')
        .getMany()
    );
  }

  /** The meeting-settings version in force on a date (default today). */
  private async effectiveSettings(
    congregationId: string,
    onDate: string,
  ): Promise<MeetingSettings | null> {
    const rows = await this.meetingRepo.find({
      where: {
        congregationId,
        effectiveFrom: LessThanOrEqual(onDate),
      },
      order: { effectiveFrom: 'DESC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /** Microphone-slot count effective for a date (default 2). */
  private async micCount(
    congregationId: string,
    onDate: string,
  ): Promise<number> {
    const settings = await this.effectiveSettings(congregationId, onDate);
    return settings?.microphoneSlots ?? 2;
  }

  /**
   * Update the microphone-slot count on the currently effective meeting-settings
   * version (in place — the count reflects the hall, not a dated change). New
   * microphone slots appear next time a week's duties are generated.
   */
  async setMicrophoneSlots(
    congregationId: string,
    microphoneSlots: number,
  ): Promise<MeetingSettings> {
    // This picks the version it is about to SAVE onto, so an off-by-one day
    // does not merely display wrong — it edits the wrong row.
    const today = await this.clock.todayFor(congregationId);
    const settings = await this.effectiveSettings(congregationId, today);
    if (!settings) {
      throw new NotFoundException('No meeting settings to update');
    }
    settings.microphoneSlots = microphoneSlots;
    return this.meetingRepo.save(settings);
  }

  /**
   * Idempotently create the standard duty slots for one meeting. Existing rows
   * are kept (ON CONFLICT DO NOTHING via the unique slot constraint), so this
   * can be re-run after the microphone count changes to add the new slots.
   * Returns the meeting's duties afterwards.
   */
  async generateWeek(
    congregationId: string,
    dto: GenerateWeekDutiesDto,
  ): Promise<Duty[]> {
    await this.assertEditable(congregationId, dto.weekStartDate, dto.eventType);
    // A meeting an EVENT took away has no duties to fill.
    //
    // Until now nothing on the server said so: the app generates these by
    // itself when the schedule screen opens, and «на неделе конгресса
    // обязанностей нет» rested entirely on one line in one client effect. Any
    // other way in — a second screen, a retry, a future caller — walked
    // straight past it.
    //
    // Judged by the EVENT, not by "is it in the list of meetings": a
    // congregation whose meeting settings are not filled in yet also has no
    // meetings in that list, and refusing there would stop a new congregation
    // from setting itself up. The tests caught exactly that.
    // The Memorial is asked about differently: it is not one of the two
    // ordinary meetings that an event can take away — it IS the event, and it
    // is held exactly on the week that holds it.
    if (dto.eventType === EventType.MEMORIAL) {
      const rules = await this.rulesOfWeek(congregationId, dto.weekStartDate);
      if (!rules.memorial) {
        throw new ConflictException(
          'There is no Memorial that week, so it has no duties.',
        );
      }
    }

    const kind: MeetingKind | null =
      dto.eventType === EventType.MIDWEEK
        ? 'midweek'
        : dto.eventType === EventType.WEEKEND
          ? 'weekend'
          : null;
    if (kind) {
      const rules = await this.rulesOfWeek(congregationId, dto.weekStartDate);
      const takenBy = !rules.meetingsHeld
        ? 'congress'
        : rules.memorialTakes === kind
          ? 'memorial'
          : rules.replacedBy(kind)
            ? 'event'
            : null;
      if (takenBy) {
        throw new ConflictException(
          'That meeting is not held this week, so it has no duties.',
        );
      }
    }
    const mics = await this.micCount(congregationId, dto.weekStartDate);
    const rows: Partial<Duty>[] = [];
    const base = {
      congregationId,
      weekStartDate: dto.weekStartDate,
      eventType: dto.eventType,
      customLabel: null,
      publisherId: null,
    };

    // The Memorial wants a different evening's hands: the main hall and the
    // foyer rather than one attendant, several brothers at the parking, and
    // the places the emblems pass. They are CUSTOM duties, so the labels are
    // the congregation's own and can be renamed or removed — nothing here is
    // a rule, only a first sheet so that nobody starts from an empty one.
    if (dto.eventType === EventType.MEMORIAL) {
      // FROM LAST YEAR'S MEMORIAL, and only from the code when there is no
      // last year. The congregation renames the places for its own hall, adds
      // one and drops another; without this all of that would be undone every
      // spring and done again by hand. The same rule the programme follows —
      // labels, counts and notes travel, PEOPLE do not.
      const previous = await this.previousMemorialDuties(
        congregationId,
        dto.weekStartDate,
      );
      const places =
        previous.length > 0
          ? previous
          : MEMORIAL_DUTIES.map((p) => ({
              label: p.label,
              count: p.count,
              notes: p.notes ?? null,
            }));
      let slot = 0;
      let order = 0;
      for (const place of places) {
        // One position per PLACE: its rows move together, because the number
        // inside a place means nothing to anybody.
        order += 1;
        for (let n = 0; n < place.count; n++) {
          rows.push({
            ...base,
            dutyType: DutyType.CUSTOM,
            customLabel: place.label,
            sortOrder: order,
            // The reminder belongs to the PLACE, so every row of it carries
            // the same words: the jackets are for all three at the parking.
            notes: place.notes ?? null,
            slotIndex: slot++,
          });
        }
      }
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(Duty)
        .values(rows)
        .orIgnore()
        .execute();
      return this.list(congregationId, {
        weekStart: dto.weekStartDate,
        eventType: dto.eventType,
      });
    }

    // The positions follow the order the screen has always shown, so nothing
    // moves the day this ships; from then on they are the congregation's to
    // change.
    let order = 0;
    for (const dutyType of SINGLE_SLOT_DUTIES_BEFORE_MIC) {
      rows.push({ ...base, dutyType, slotIndex: 0, sortOrder: ++order });
    }
    order += 1; // all the microphones are ONE place
    for (let i = 0; i < mics; i++) {
      rows.push({
        ...base,
        dutyType: DutyType.MICROPHONE,
        slotIndex: i,
        sortOrder: order,
      });
    }
    for (const dutyType of SINGLE_SLOT_DUTIES_AFTER_MIC) {
      rows.push({ ...base, dutyType, slotIndex: 0, sortOrder: ++order });
    }

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(Duty)
      .values(rows)
      .orIgnore()
      .execute();

    // Trigger B: if the Treasures talk speaker is already set, mirror them onto
    // microphone slot 0 (fills the gap when the program precedes duty generation).
    await this.reconcileTreasuresMic(
      congregationId,
      dto.weekStartDate,
      dto.eventType,
    );

    return this.list(congregationId, {
      weekStart: dto.weekStartDate,
      eventType: dto.eventType,
    });
  }

  /**
   * Congregation rule (Stage 2): the Treasures-talk speaker also carries
   * microphone #1 (slot 0) of the same midweek meeting. Called from both the
   * assignment editor (when the speaker changes) and `generateWeek` (when the
   * mic slots are created), so it works whichever is set up first.
   *
   * Smart default: fill slot 0 when empty or still holding the previous
   * speaker; clear it when the speaker is removed; leave it alone (with a soft
   * "already taken" hint) when someone else was placed there manually. The
   * `duty_microphone` capability is advisory only — same as a manual assign.
   */
  async reconcileTreasuresMic(
    congregationId: string,
    weekStartDate: string,
    eventType: EventType,
    prevSpeakerId?: string | null,
  ): Promise<MicRuleWarning[]> {
    if (eventType !== EventType.MIDWEEK) return [];
    const congregation = await this.congregationRepo.findOne({
      where: { id: congregationId },
    });
    if (!congregation?.assignmentAutomationEnabled) return [];

    const mic = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate,
        eventType,
        dutyType: DutyType.MICROPHONE,
        slotIndex: 0,
      },
    });
    if (!mic) return [];

    const speaker = await this.assignmentRepo.findOne({
      where: {
        congregationId,
        weekStartDate,
        eventType,
        partKey: 'treasures_talk',
      },
    });
    const speakerId = speaker?.publisherId ?? null;
    const micHolder = mic.publisherId;

    // Speaker removed -> clear the mic only if it mirrored that speaker.
    if (speakerId == null) {
      if (prevSpeakerId != null && micHolder === prevSpeakerId) {
        mic.publisherId = null;
        await this.repo.save(mic);
      }
      return [];
    }

    const micIsAutoOrEmpty =
      micHolder == null ||
      (prevSpeakerId != null && micHolder === prevSpeakerId);

    if (!micIsAutoOrEmpty) {
      if (micHolder !== speakerId) {
        const holder = await this.publisherRepo.findOne({
          where: { id: micHolder as string, congregationId },
        });
        return [
          { code: 'mic_taken', publisherName: holder?.displayName ?? '' },
        ];
      }
      return [];
    }

    if (micHolder !== speakerId) {
      mic.publisherId = speakerId;
      await this.repo.save(mic);
    }

    // Advisory capability flag, mirroring the manual-assign behaviour.
    const speakerPub = await this.publisherRepo.findOne({
      where: { id: speakerId, congregationId },
    });
    const caps = (speakerPub?.capabilities ?? {}) as Record<string, boolean>;
    if (caps['duty_microphone'] !== true) {
      return [
        {
          code: 'mic_capability_off',
          publisherName: speakerPub?.displayName ?? '',
        },
      ];
    }
    return [];
  }

  private async getOne(congregationId: string, id: string): Promise<Duty> {
    const duty = await this.repo.findOne({ where: { id, congregationId } });
    if (!duty) {
      throw new NotFoundException('Duty not found');
    }
    return duty;
  }

  /** Non-blocking conflict checks for assigning a publisher to a duty. */
  private async conflicts(
    congregationId: string,
    duty: Duty,
    publisherId: string,
  ): Promise<DutyWarning[]> {
    const warnings: DutyWarning[] = [];

    const otherDuty = await this.repo.count({
      where: {
        congregationId,
        weekStartDate: duty.weekStartDate,
        eventType: duty.eventType,
        publisherId,
        id: Not(duty.id),
      },
    });
    if (otherDuty > 0) warnings.push('already_on_duty');

    const programPart = await this.assignmentRepo.count({
      where: [
        {
          congregationId,
          weekStartDate: duty.weekStartDate,
          eventType: duty.eventType,
          publisherId,
        },
        {
          congregationId,
          weekStartDate: duty.weekStartDate,
          eventType: duty.eventType,
          assistantPublisherId: publisherId,
        },
      ],
    });
    if (programPart > 0) warnings.push('has_program_part');

    if (duty.dutyType !== DutyType.CUSTOM) {
      const publisher = await this.publisherRepo.findOne({
        where: { id: publisherId, congregationId },
      });
      const caps = (publisher?.capabilities ?? {}) as Record<string, boolean>;
      if (caps[`duty_${duty.dutyType}`] !== true) {
        warnings.push('capability_off');
      }
    }

    return warnings;
  }

  /** Assign (or clear, with publisherId null) a publisher on a duty slot. */
  async assign(
    congregationId: string,
    id: string,
    dto: AssignDutyDto,
  ): Promise<DutyWithWarnings> {
    const duty = await this.getOne(congregationId, id);
    await this.assertEditable(
      congregationId,
      duty.weekStartDate,
      duty.eventType,
    );
    const previousPublisherId = duty.publisherId ?? null;
    duty.publisherId = dto.publisherId ?? null;
    if (dto.notes !== undefined) duty.notes = dto.notes;
    const saved = await this.repo.save(duty);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'duty',
      entityId: saved.id,
      subjectId: saved.publisherId ?? previousPublisherId,
      before: { publisherId: previousPublisherId },
      after: { publisherId: saved.publisherId ?? null },
      fields: ['publisherId'],
    });
    const warnings = duty.publisherId
      ? await this.conflicts(congregationId, saved, duty.publisherId)
      : [];
    return { duty: saved, warnings };
  }

  /** Add a one-week custom duty (free label, any publisher). */
  async createCustom(
    congregationId: string,
    dto: CreateCustomDutyDto,
  ): Promise<DutyWithWarnings> {
    await this.assertEditable(congregationId, dto.weekStartDate, dto.eventType);
    const raw = await this.repo
      .createQueryBuilder('d')
      .select('MAX(d.slotIndex)', 'max')
      .where('d.congregationId = :congregationId', { congregationId })
      .andWhere('d.weekStartDate = :weekStartDate', {
        weekStartDate: dto.weekStartDate,
      })
      .andWhere('d.eventType = :eventType', { eventType: dto.eventType })
      .andWhere('d.dutyType = :dutyType', { dutyType: DutyType.CUSTOM })
      .getRawOne<{ max: number | null }>();
    const slotIndex = (raw?.max == null ? -1 : Number(raw.max)) + 1;

    // A new place goes to the END of the sheet — and «Ещё брат» joins the
    // place it belongs to, so it takes that place's position rather than a new
    // one at the bottom.
    const sibling = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate: dto.weekStartDate,
        eventType: dto.eventType,
        dutyType: DutyType.CUSTOM,
        customLabel: dto.customLabel,
      },
    });
    let sortOrder: number;
    if (sibling) {
      sortOrder = sibling.sortOrder;
    } else {
      const last = await this.repo
        .createQueryBuilder('d')
        .select('MAX(d.sortOrder)', 'max')
        .where('d.congregationId = :congregationId', { congregationId })
        .andWhere('d.weekStartDate = :weekStartDate', {
          weekStartDate: dto.weekStartDate,
        })
        .andWhere('d.eventType = :eventType', { eventType: dto.eventType })
        .getRawOne<{ max: number | null }>();
      sortOrder = (last?.max == null ? 0 : Number(last.max)) + 1;
    }

    const duty = this.repo.create({
      congregationId,
      weekStartDate: dto.weekStartDate,
      eventType: dto.eventType,
      dutyType: DutyType.CUSTOM,
      slotIndex,
      customLabel: dto.customLabel,
      publisherId: dto.publisherId ?? null,
      sortOrder,
    });
    const saved = await this.repo.save(duty);
    const warnings = saved.publisherId
      ? await this.conflicts(congregationId, saved, saved.publisherId)
      : [];
    return { duty: saved, warnings };
  }

  /**
   * The places of the LAST Memorial that had any, newest first.
   *
   * Gathered into places rather than rows: how many stand at each is part of
   * what the congregation decided, so three at the parking stay three.
   */
  private async previousMemorialDuties(
    congregationId: string,
    weekStartDate: string,
  ): Promise<{ label: string; count: number; notes: string | null }[]> {
    const rows = await this.repo.find({
      where: {
        congregationId,
        eventType: EventType.MEMORIAL,
        weekStartDate: LessThan(weekStartDate),
      },
      order: { weekStartDate: 'DESC', slotIndex: 'ASC' },
    });
    if (rows.length === 0) return [];
    const latest = rows[0].weekStartDate;
    const places: { label: string; count: number; notes: string | null }[] = [];
    for (const r of rows) {
      if (r.weekStartDate !== latest) break;
      const label = r.customLabel ?? '';
      const last = places[places.length - 1];
      if (last && last.label === label) last.count += 1;
      else places.push({ label, count: 1, notes: r.notes ?? null });
    }
    return places;
  }

  /**
   * Move a place up or down the sheet.
   *
   * The caller sends one row of the place and which way it goes; the whole
   * place moves, because its rows are one thing to everybody who reads the
   * sheet. Positions are then renumbered from one, so no gap or duplicate can
   * accumulate over years of moving.
   *
   * Arrows rather than dragging: dragging is fiddly on a phone, would pull
   * another library into the Expo fingerprint, and cannot be checked by a
   * test. If dragging is ever wanted it lands on the same column.
   */
  async movePlace(
    congregationId: string,
    id: string,
    direction: 'up' | 'down',
  ): Promise<Duty[]> {
    const duty = await this.getOne(congregationId, id);
    await this.assertEditable(
      congregationId,
      duty.weekStartDate,
      duty.eventType,
    );
    const all = await this.repo.find({
      where: {
        congregationId,
        weekStartDate: duty.weekStartDate,
        eventType: duty.eventType,
      },
      order: { sortOrder: 'ASC', dutyType: 'ASC', slotIndex: 'ASC' },
    });

    // The places in their present order, each with the rows that belong to it.
    const places: { key: string; rows: Duty[] }[] = [];
    for (const r of all) {
      const key = `${r.dutyType}|${r.customLabel ?? ''}`;
      const last = places[places.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else places.push({ key, rows: [r] });
    }

    const from = places.findIndex((p) => p.rows.some((r) => r.id === id));
    const to = direction === 'up' ? from - 1 : from + 1;
    // Already at the edge: nothing to do, and nothing to complain about — the
    // arrow is simply spent.
    if (from < 0 || to < 0 || to >= places.length) return all;

    const [moved] = places.splice(from, 1);
    places.splice(to, 0, moved);

    let order = 0;
    const toSave: Duty[] = [];
    for (const place of places) {
      order += 1;
      for (const r of place.rows) {
        if (r.sortOrder !== order) {
          r.sortOrder = order;
          toSave.push(r);
        }
      }
    }
    if (toSave.length > 0) await this.repo.save(toSave);
    return this.list(congregationId, {
      weekStart: duty.weekStartDate,
      eventType: duty.eventType,
    });
  }

  /**
   * Rename a place — ALL of its rows at once.
   *
   * «Стоянка» is three rows sharing a label; renaming one would split the
   * group in two and the screen would show two places where the congregation
   * has one. So the label is changed for every row of that place in that week
   * and that meeting.
   *
   * ONLY a place the congregation named itself. A predefined duty takes its
   * name from the translations — «Сцена» in Russian, «Bühne» in German — and
   * writing over it would break the language for everybody else. That is the
   * same line the delete button already draws.
   *
   * Nothing here can reach the starting lists: those live in the code, and
   * duties are keyed by week and meeting, so a rename touches one week only.
   */
  async renamePlace(
    congregationId: string,
    id: string,
    label: string,
  ): Promise<Duty[]> {
    const duty = await this.getOne(congregationId, id);
    await this.assertEditable(
      congregationId,
      duty.weekStartDate,
      duty.eventType,
    );
    if (duty.dutyType !== DutyType.CUSTOM) {
      throw new ConflictException(
        'Only a duty the congregation added itself can be renamed.',
      );
    }
    const rows = await this.repo.find({
      where: {
        congregationId,
        weekStartDate: duty.weekStartDate,
        eventType: duty.eventType,
        dutyType: DutyType.CUSTOM,
        customLabel: duty.customLabel ?? undefined,
      },
    });
    const before = duty.customLabel;
    for (const r of rows) r.customLabel = label;
    await this.repo.save(rows);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'duty',
      entityId: id,
      before: { customLabel: before },
      after: { customLabel: label },
      fields: ['customLabel'],
    });
    return rows;
  }

  /**
   * Remove a place with everybody standing at it.
   *
   * The bin on a row takes ONE person off a place — replacing one of the three
   * at the parking is ordinary work. Removing the parking itself meant
   * pressing it three times, so this does the whole place in one go.
   *
   * Own places only, for the same reason as the rename.
   */
  async removePlace(congregationId: string, id: string): Promise<void> {
    const duty = await this.getOne(congregationId, id);
    await this.assertEditable(
      congregationId,
      duty.weekStartDate,
      duty.eventType,
    );
    if (duty.dutyType !== DutyType.CUSTOM) {
      throw new ConflictException(
        'Only a duty the congregation added itself can be removed this way.',
      );
    }
    const rows = await this.repo.find({
      where: {
        congregationId,
        weekStartDate: duty.weekStartDate,
        eventType: duty.eventType,
        dutyType: DutyType.CUSTOM,
        customLabel: duty.customLabel ?? undefined,
      },
    });
    await this.repo.remove(rows);
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'duty',
      entityId: id,
      action: 'DELETE',
      detail: {
        weekStartDate: duty.weekStartDate,
        eventType: duty.eventType,
        label: duty.customLabel ?? null,
        rows: rows.length,
      },
    });
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const duty = await this.getOne(congregationId, id);
    await this.assertEditable(
      congregationId,
      duty.weekStartDate,
      duty.eventType,
    );
    await this.repo.remove(duty);
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'duty',
      entityId: id,
      action: 'DELETE',
      subjectId: duty.publisherId ?? null,
      detail: {
        weekStartDate: duty.weekStartDate,
        eventType: duty.eventType,
        label: duty.customLabel ?? null,
      },
    });
  }
}
