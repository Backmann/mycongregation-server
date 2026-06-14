import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, IsNull, Not, In } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { QueryAssignmentDto } from './dto/query-assignment.dto';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { EventType } from '../common/enums/event-type.enum';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectRepository(Assignment)
    private readonly repo: Repository<Assignment>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly pushNotifications: PushNotificationsService,
  ) {}

  /**
   * Schedule editors (admin, or holders of a schedule responsibility) may
   * see drafts and removed rows; everyone else only sees the published
   * programme. No user context (internal module-to-module call) is trusted.
   */
  private async canSeeDrafts(user?: AuthenticatedUser): Promise<boolean> {
    if (!user) return true;
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([
          'life_ministry_overseer',
          'body_coordinator',
        ] as ResponsibilityType[]),
      },
    });
    return held > 0;
  }

  async list(
    congregationId: string,
    query: QueryAssignmentDto,
    user?: AuthenticatedUser,
  ): Promise<PaginatedResult<Assignment>> {
    const editor = await this.canSeeDrafts(user);
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.congregationId = :congregationId', { congregationId });

    if (query.weekStart) {
      qb.andWhere('a.weekStartDate >= :weekStart', {
        weekStart: query.weekStart,
      });
    }
    if (query.weekEnd) {
      qb.andWhere('a.weekStartDate < :weekEnd', { weekEnd: query.weekEnd });
    }
    if (query.eventType) {
      qb.andWhere('a.eventType = :eventType', { eventType: query.eventType });
    }
    if (!editor) {
      // Non-editors only ever see the published programme.
      qb.andWhere("a.status = 'published'");
    } else if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }
    if (query.publisherId) {
      qb.andWhere(
        '(a.publisherId = :publisherId OR a.assistantPublisherId = :publisherId)',
        { publisherId: query.publisherId },
      );
    }
    if (query.partKey) {
      qb.andWhere('a.partKey = :partKey', { partKey: query.partKey });
    }

    if (editor && query.includeRemoved) {
      qb.withDeleted();
    }

    qb.orderBy('a.weekStartDate', 'ASC')
      .addOrderBy('a.eventType', 'ASC')
      .addOrderBy('a.partOrder', 'ASC')
      .addOrderBy('a.partKey', 'ASC')
      .skip(offset)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit, offset };
  }

  async getById(
    congregationId: string,
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Assignment> {
    const assignment = await this.repo.findOne({
      where: { id, congregationId },
      withDeleted: true,
    });
    if (!assignment) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    if (
      (String(assignment.status) !== 'published' || assignment.deletedAt) &&
      !(await this.canSeeDrafts(user))
    ) {
      // Hide non-published / removed rows from non-editors as if absent.
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    return assignment;
  }

  async create(
    congregationId: string,
    dto: CreateAssignmentDto,
  ): Promise<Assignment> {
    const assignment = this.repo.create({
      ...dto,
      congregationId,
    });
    return this.repo.save(assignment);
  }

  async bulkCreate(
    congregationId: string,
    dtos: CreateAssignmentDto[],
  ): Promise<Assignment[]> {
    const entities = dtos.map((dto) =>
      this.repo.create({ ...dto, congregationId }),
    );
    return this.repo.save(entities);
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateAssignmentDto,
  ): Promise<Assignment> {
    const existing = await this.getById(congregationId, id);
    if (existing.deletedAt) {
      throw new NotFoundException(
        `Assignment ${id} is removed; restore it before updating`,
      );
    }
    Object.assign(existing, dto);
    return this.repo.save(existing);
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const existing = await this.getById(congregationId, id);
    if (existing.deletedAt) {
      return;
    }
    await this.repo.softDelete({
      id,
      congregationId,
    });
  }

  async restore(congregationId: string, id: string): Promise<Assignment> {
    const existing = await this.repo.findOne({
      where: {
        id,
        congregationId,
        deletedAt: Not(IsNull()),
      },
      withDeleted: true,
    });
    if (!existing) {
      throw new NotFoundException(`Removed assignment ${id} not found`);
    }
    await this.repo.restore({
      id,
      congregationId,
    });
    return this.getById(congregationId, id);
  }

  /**
   * Bulk-publish one meeting: every draft assignment of the given week +
   * section becomes published. Soft-deleted rows are left untouched, as
   * are already-published and cancelled rows (idempotent by design).
   */
  async publishMeeting(
    congregationId: string,
    weekStartDate: string,
    eventType: EventType,
    notify = true,
  ): Promise<{ published: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update(Assignment)
      .set({ status: 'published' as AssignmentStatus })
      .where('congregationId = :congregationId', { congregationId })
      .andWhere('weekStartDate = :weekStartDate', { weekStartDate })
      .andWhere('eventType = :eventType', { eventType })
      .andWhere("status = 'draft'")
      .andWhere('deletedAt IS NULL')
      .execute();
    const published = result.affected ?? 0;
    const kind = String(eventType);
    if (notify && published > 0 && (kind === 'midweek' || kind === 'weekend')) {
      // Fire-and-forget: the congregation learns the programme is out.
      void this.pushNotifications.sendSchedulePublished(
        congregationId,
        kind,
        weekStartDate,
      );
    }
    return { published };
  }
}
