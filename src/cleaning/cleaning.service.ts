import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { SetCleaningSlotDto } from './dto/set-cleaning-slot.dto';
import { PlanThoroughDto } from './dto/plan-thorough.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

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
    @InjectRepository(Publisher)
    private readonly publisherRepo: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilityRepo: Repository<Responsibility>,
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

  /** Deduplicated, ascending window numbers; null when empty or not given. */
  private static normalizeWindows(
    windows: number[] | null | undefined,
  ): number[] | null {
    if (!windows || windows.length === 0) return null;
    return [...new Set(windows)].sort((a, b) => a - b);
  }

  async setSlot(
    congregationId: string,
    dto: SetCleaningSlotDto,
  ): Promise<CleaningAssignment> {
    const isThorough = dto.slotType === CleaningSlotType.THOROUGH;
    const serviceGroupId =
      dto.slotType === CleaningSlotType.GENERAL
        ? null
        : (dto.serviceGroupId ?? null);
    const windows = isThorough
      ? CleaningService.normalizeWindows(dto.windows)
      : null;

    const existing = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate: dto.weekStartDate,
        slotType: dto.slotType,
      },
    });

    if (existing) {
      // A different group means the previously agreed day no longer applies.
      if (isThorough && existing.serviceGroupId !== serviceGroupId) {
        existing.thoroughPlannedAt = null;
      }
      existing.serviceGroupId = serviceGroupId;
      existing.windows = windows;
      return this.repo.save(existing);
    }

    const row = this.repo.create({
      congregationId,
      weekStartDate: dto.weekStartDate,
      slotType: dto.slotType,
      serviceGroupId,
      windows,
    });
    return this.repo.save(row);
  }

  /**
   * Set (or clear, with plannedAt = null) the day the assigned group plans to
   * do the weekly thorough cleaning. Allowed for admins, holders of the
   * cleaning_coordinator responsibility, and the overseer of the assigned
   * group — the person who actually knows when the group is available.
   */
  async planThorough(
    congregationId: string,
    dto: PlanThoroughDto,
    user: AuthenticatedUser,
  ): Promise<CleaningAssignment> {
    const slot = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate: dto.weekStartDate,
        slotType: CleaningSlotType.THOROUGH,
      },
    });
    if (!slot || !slot.serviceGroupId) {
      throw new NotFoundException(
        'No thorough cleaning assignment with a group for this week',
      );
    }

    const plannedAt = dto.plannedAt ? new Date(dto.plannedAt) : null;
    if (plannedAt) {
      const weekStart = new Date(`${dto.weekStartDate}T00:00:00Z`);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      // Local wall-clock times land within a day of the UTC week bounds.
      const slack = 24 * 60 * 60 * 1000;
      if (
        plannedAt.getTime() < weekStart.getTime() - slack ||
        plannedAt.getTime() >= weekEnd.getTime() + slack
      ) {
        throw new BadRequestException(
          'plannedAt must fall inside the assignment week',
        );
      }
    }

    const allowed = await this.canPlanThorough(
      congregationId,
      slot.serviceGroupId,
      user,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Only the cleaning coordinator or the overseer of the assigned group can plan it',
      );
    }

    slot.thoroughPlannedAt = plannedAt;
    return this.repo.save(slot);
  }

  private async canPlanThorough(
    congregationId: string,
    serviceGroupId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;

    const holdsResponsibility = await this.responsibilityRepo.count({
      where: {
        congregationId,
        userId: user.id,
        type: ResponsibilityType.CLEANING_COORDINATOR,
      },
    });
    if (holdsResponsibility > 0) return true;

    const group = await this.groupRepo.findOne({
      where: { id: serviceGroupId, congregationId },
    });
    if (!group?.overseerPublisherId) return false;

    const myPublisher = await this.publisherRepo.findOne({
      where: { congregationId, userId: user.id },
    });
    return myPublisher?.id === group.overseerPublisherId;
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
