import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';
import { SetCleaningSlotDto } from './dto/set-cleaning-slot.dto';

export interface CleaningWeek {
  assignments: CleaningAssignment[];
  /** Round-robin hint for the after-meeting slot (the "next group in turn"). */
  suggestedAfterMeetingGroupId: string | null;
}

@Injectable()
export class CleaningService {
  constructor(
    @InjectRepository(CleaningAssignment)
    private readonly repo: Repository<CleaningAssignment>,
    @InjectRepository(ServiceGroup)
    private readonly groupRepo: Repository<ServiceGroup>,
  ) {}

  async getWeek(
    congregationId: string,
    weekStart: string,
  ): Promise<CleaningWeek> {
    const assignments = await this.repo.find({
      where: { congregationId, weekStartDate: weekStart },
      order: { slotType: 'ASC' },
    });
    const suggestedAfterMeetingGroupId =
      await this.suggestNextAfterMeetingGroup(congregationId, weekStart);
    return { assignments, suggestedAfterMeetingGroupId };
  }

  /** Groups of a congregation, soft-deleted excluded, ordered by name. */
  private orderedGroups(congregationId: string): Promise<ServiceGroup[]> {
    return this.groupRepo.find({
      where: { congregationId },
      order: { name: 'ASC' },
    });
  }

  /**
   * The group that should clean after meetings this week, following the
   * rotation: the group right after whoever did it most recently. If nothing
   * has been assigned before (or the prior group no longer exists), the first
   * group is suggested. Null when the congregation has no groups.
   */
  async suggestNextAfterMeetingGroup(
    congregationId: string,
    weekStart: string,
  ): Promise<string | null> {
    const groups = await this.orderedGroups(congregationId);
    if (groups.length === 0) return null;

    const prior = await this.repo.findOne({
      where: {
        congregationId,
        slotType: CleaningSlotType.AFTER_MEETING,
        weekStartDate: LessThan(weekStart),
      },
      order: { weekStartDate: 'DESC' },
    });

    if (!prior || !prior.serviceGroupId) return groups[0].id;
    const idx = groups.findIndex((g) => g.id === prior.serviceGroupId);
    if (idx === -1) return groups[0].id;
    return groups[(idx + 1) % groups.length].id;
  }

  async setSlot(
    congregationId: string,
    dto: SetCleaningSlotDto,
  ): Promise<CleaningAssignment> {
    const serviceGroupId =
      dto.slotType === CleaningSlotType.GENERAL
        ? null
        : (dto.serviceGroupId ?? null);

    const existing = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate: dto.weekStartDate,
        slotType: dto.slotType,
      },
    });

    if (existing) {
      existing.serviceGroupId = serviceGroupId;
      return this.repo.save(existing);
    }

    const row = this.repo.create({
      congregationId,
      weekStartDate: dto.weekStartDate,
      slotType: dto.slotType,
      serviceGroupId,
    });
    return this.repo.save(row);
  }

  /** Clearing is idempotent — removing a non-existent slot is a no-op. */
  async clearSlot(
    congregationId: string,
    weekStartDate: string,
    slotType: CleaningSlotType,
  ): Promise<void> {
    await this.repo.delete({ congregationId, weekStartDate, slotType });
  }
}
