import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, Repository } from 'typeorm';
import { LocalNeedsTopic } from '../entities/local-needs-topic.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateLocalNeedsTopicDto } from './dto/create-local-needs-topic.dto';
import { UpdateLocalNeedsTopicDto } from './dto/update-local-needs-topic.dto';
import { QueryLocalNeedsTopicsDto } from './dto/query-local-needs-topics.dto';
import { MarkUsedLocalNeedsTopicDto } from './dto/mark-used-local-needs-topic.dto';
import { CongregationClock } from '../common/congregation-clock.service';
import { mondayOf } from '../common/week';

@Injectable()
export class LocalNeedsService {
  constructor(
    @InjectRepository(LocalNeedsTopic)
    private readonly repo: Repository<LocalNeedsTopic>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
  ) {}

  /**
   * Responsibilities that may manage the local-needs backlog. Per the body of
   * elders: only the Life & Ministry overseer (midweek) edits; admins always
   * pass.
   */
  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
  ];

  /** True when the user may edit the backlog (admin or Life & Ministry overseer). */
  private async isManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(LocalNeedsService.MANAGER_RESPONSIBILITIES),
      },
    });
    return held > 0;
  }

  private async assertCanManage(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isManager(user))) {
      throw new ForbiddenException('Not allowed to manage local needs');
    }
  }

  /** Reading is limited to elders (admins and managers always pass). */
  private async assertCanView(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) return;
    if (await this.isManager(user)) return;
    throw new ForbiddenException('Local needs are visible to elders only');
  }

  private baseQuery(tenantId: string) {
    // leftJoin (not AndSelect) + explicit addSelect keeps encrypted publisher
    // columns out of the query while still hydrating a light speaker object.
    return this.repo
      .createQueryBuilder('t')
      .leftJoin('t.speaker', 's')
      .addSelect(['s.id', 's.displayName', 's.firstName', 's.lastName'])
      .where('t.congregation_id = :tenantId', { tenantId });
  }

  async findAll(
    tenantId: string,
    query: QueryLocalNeedsTopicsDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic[]> {
    await this.assertCanView(user);
    const qb = this.baseQuery(tenantId);

    if (query.onlyPlanned === 'true') {
      qb.andWhere('t.used_week IS NULL');
    }
    if (query.includeRemoved === 'true') {
      qb.withDeleted();
    }

    // Planned (used_week null) first, then used topics newest-week first.
    return qb
      .orderBy('t.used_week', 'DESC', 'NULLS FIRST')
      .addOrderBy('t.created_at', 'ASC')
      .getMany();
  }

  async findOne(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanView(user);
    const found = await this.baseQuery(tenantId)
      .andWhere('t.id = :id', { id })
      .withDeleted()
      .getOne();
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    return found;
  }

  async create(
    tenantId: string,
    dto: CreateLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const entity = this.repo.create({
      ...dto,
      congregationId: tenantId,
      createdById: user.id,
    });
    const saved = await this.repo.save(entity);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      after: {
        title: saved.title,
        notes: saved.notes,
        speakerPublisherId: saved.speakerPublisherId,
        usedWeek: saved.usedWeek,
      },
    });
    return saved;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    const before = {
      title: found.title,
      notes: found.notes,
      speakerPublisherId: found.speakerPublisherId,
      usedWeek: found.usedWeek,
    };
    Object.assign(found, dto);
    // A week is identified by its Monday everywhere else in the app; a topic
    // filed under a Wednesday would sort and group as its own private week.
    if (found.usedWeek) found.usedWeek = mondayOf(found.usedWeek);
    if (!found.usedWeek) found.usedAssignmentId = null;
    const saved = await this.repo.save(found);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      before,
      after: {
        title: saved.title,
        notes: saved.notes,
        speakerPublisherId: saved.speakerPublisherId,
        usedWeek: saved.usedWeek,
      },
      fields: ['title', 'notes', 'speakerPublisherId', 'usedWeek'],
    });
    return saved;
  }

  /**
   * Mark a topic as used — by default in the congregation's current week.
   *
   * The week comes from the SERVER's reading of the congregation's clock when
   * the caller does not name one, so «отметить как прошедшую» means the same
   * thing whatever timezone the phone is set to. Naming a week explicitly is
   * how a topic given three weeks ago is recorded after the fact.
   */
  async markUsed(
    tenantId: string,
    id: string,
    dto: MarkUsedLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    const before = {
      usedWeek: found.usedWeek,
      usedAssignmentId: found.usedAssignmentId,
    };
    found.usedWeek = mondayOf(
      dto.week ?? (await this.clock.todayFor(tenantId)),
    );
    found.usedAssignmentId = dto.assignmentId ?? null;
    const saved = await this.repo.save(found);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      before,
      after: {
        usedWeek: saved.usedWeek,
        usedAssignmentId: saved.usedAssignmentId,
      },
      fields: ['usedWeek', 'usedAssignmentId'],
    });
    return saved;
  }

  /** Put a topic back in the plan: no week, and no part it belongs to. */
  async markPlanned(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    const before = {
      usedWeek: found.usedWeek,
      usedAssignmentId: found.usedAssignmentId,
    };
    found.usedWeek = null;
    found.usedAssignmentId = null;
    const saved = await this.repo.save(found);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      before,
      after: { usedWeek: null, usedAssignmentId: null },
      fields: ['usedWeek', 'usedAssignmentId'],
    });
    return saved;
  }

  /**
   * The meeting part is gone, or no longer carries this topic — so the topic
   * was not used after all, and goes back to the plan.
   *
   * Called from the assignments service. Silent by design: nobody asked for
   * this, it is the app keeping its own record straight, and a notification
   * about it would be noise. It IS journalled, because a topic that changes
   * state on its own is exactly the kind of thing someone later disputes.
   */
  async releaseAssignment(
    tenantId: string,
    assignmentId: string,
  ): Promise<void> {
    const bound = await this.repo.find({
      where: { congregationId: tenantId, usedAssignmentId: assignmentId },
    });
    for (const topic of bound) {
      const before = {
        usedWeek: topic.usedWeek,
        usedAssignmentId: topic.usedAssignmentId,
      };
      topic.usedWeek = null;
      topic.usedAssignmentId = null;
      await this.repo.save(topic);
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'local_need',
        entityId: topic.id,
        subjectId: topic.speakerPublisherId,
        before,
        after: { usedWeek: null, usedAssignmentId: null },
        fields: ['usedWeek', 'usedAssignmentId'],
      });
    }
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'local_need',
      entityId: id,
      action: 'DELETE',
      subjectId: found.speakerPublisherId,
      detail: { title: found.title },
    });
    await this.repo.softDelete(id);
  }

  async restore(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    await this.repo.restore(id);
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'local_need',
      entityId: id,
      action: 'RESTORE',
      subjectId: found.speakerPublisherId,
      detail: { title: found.title },
    });
    return this.findOne(tenantId, id, user);
  }
}
