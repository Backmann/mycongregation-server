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

@Injectable()
export class LocalNeedsService {
  constructor(
    @InjectRepository(LocalNeedsTopic)
    private readonly repo: Repository<LocalNeedsTopic>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly auditLog: AuditLogService,
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
      .addOrderBy('t.sort_order', 'ASC')
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
    return this.findOne(tenantId, id, user);
  }
}
