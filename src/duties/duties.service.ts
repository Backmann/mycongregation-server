import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Not, Repository } from 'typeorm';
import { Duty } from '../entities/duty.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { EventType } from '../common/enums/event-type.enum';
import {
  DutyType,
  SINGLE_SLOT_DUTIES_AFTER_MIC,
  SINGLE_SLOT_DUTIES_BEFORE_MIC,
} from '../common/enums/duty-type.enum';
import { QueryDutiesDto } from './dto/query-duties.dto';
import { GenerateWeekDutiesDto } from './dto/generate-week-duties.dto';
import { AssignDutyDto } from './dto/assign-duty.dto';
import { CreateCustomDutyDto } from './dto/create-custom-duty.dto';

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
  ) {}

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
    return qb
      .orderBy('d.weekStartDate', 'ASC')
      .addOrderBy('d.eventType', 'ASC')
      .addOrderBy('d.dutyType', 'ASC')
      .addOrderBy('d.slotIndex', 'ASC')
      .getMany();
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
    const today = new Date().toISOString().slice(0, 10);
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
    const mics = await this.micCount(congregationId, dto.weekStartDate);
    const rows: Partial<Duty>[] = [];
    const base = {
      congregationId,
      weekStartDate: dto.weekStartDate,
      eventType: dto.eventType,
      customLabel: null,
      publisherId: null,
    };
    for (const dutyType of SINGLE_SLOT_DUTIES_BEFORE_MIC) {
      rows.push({ ...base, dutyType, slotIndex: 0 });
    }
    for (let i = 0; i < mics; i++) {
      rows.push({ ...base, dutyType: DutyType.MICROPHONE, slotIndex: i });
    }
    for (const dutyType of SINGLE_SLOT_DUTIES_AFTER_MIC) {
      rows.push({ ...base, dutyType, slotIndex: 0 });
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
    duty.publisherId = dto.publisherId ?? null;
    if (dto.notes !== undefined) duty.notes = dto.notes;
    const saved = await this.repo.save(duty);
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

    const duty = this.repo.create({
      congregationId,
      weekStartDate: dto.weekStartDate,
      eventType: dto.eventType,
      dutyType: DutyType.CUSTOM,
      slotIndex,
      customLabel: dto.customLabel,
      publisherId: dto.publisherId ?? null,
    });
    const saved = await this.repo.save(duty);
    const warnings = saved.publisherId
      ? await this.conflicts(congregationId, saved, saved.publisherId)
      : [];
    return { duty: saved, warnings };
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const duty = await this.getOne(congregationId, id);
    await this.repo.remove(duty);
  }
}
