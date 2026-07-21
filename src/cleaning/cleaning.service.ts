import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
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
    private readonly auditLog: AuditLogService,
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
      const previousGroupId = existing.serviceGroupId ?? null;
      existing.serviceGroupId = serviceGroupId;
      existing.windows = windows;
      const updated = await this.repo.save(existing);
      await this.auditLog.logUpdate({
        tenantId: congregationId,
        entityType: 'cleaning',
        entityId: updated.id,
        before: { serviceGroupId: previousGroupId },
        after: { serviceGroupId: updated.serviceGroupId ?? null },
        fields: ['serviceGroupId'],
      });
      return updated;
    }

    const row = this.repo.create({
      congregationId,
      weekStartDate: dto.weekStartDate,
      slotType: dto.slotType,
      serviceGroupId,
      windows,
    });
    const created = await this.repo.save(row);
    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'cleaning',
      entityId: created.id,
      after: {
        weekStartDate: created.weekStartDate,
        slotType: created.slotType,
        serviceGroupId: created.serviceGroupId ?? null,
      },
    });
    return created;
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
    CleaningService.assertInsideWeek(plannedAt, dto.weekStartDate);

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

  /**
   * Set (or clear) the date and time of the GENERAL (annual) cleaning for the
   * given week. Congregation-wide, so only admins and the cleaning
   * coordinator may plan it. The datetime is stored in the same
   * thoroughPlannedAt column on the general row (per-row semantics: for
   * THOROUGH — the group-agreed day, for GENERAL — the congregation-wide
   * date/time driving the 2h-before push to everyone).
   */
  async planGeneral(
    congregationId: string,
    dto: PlanThoroughDto,
    user: AuthenticatedUser,
  ): Promise<CleaningAssignment> {
    const slot = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate: dto.weekStartDate,
        slotType: CleaningSlotType.GENERAL,
      },
    });
    if (!slot) {
      throw new NotFoundException(
        'No general cleaning is scheduled for this week',
      );
    }

    const plannedAt = dto.plannedAt ? new Date(dto.plannedAt) : null;
    CleaningService.assertInsideWeek(plannedAt, dto.weekStartDate);

    const allowed = await this.isCoordinatorOrAdmin(congregationId, user);
    if (!allowed) {
      throw new ForbiddenException(
        'Only the cleaning coordinator can plan the general cleaning',
      );
    }

    slot.thoroughPlannedAt = plannedAt;
    return this.repo.save(slot);
  }

  /** Throws if the planned datetime falls outside the assignment week. */
  private static assertInsideWeek(
    plannedAt: Date | null,
    weekStartDate: string,
  ): void {
    if (!plannedAt) return;
    const weekStart = new Date(`${weekStartDate}T00:00:00Z`);
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

  private async isCoordinatorOrAdmin(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const holds = await this.responsibilityRepo.count({
      where: {
        congregationId,
        userId: user.id,
        type: ResponsibilityType.CLEANING_COORDINATOR,
      },
    });
    return holds > 0;
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
