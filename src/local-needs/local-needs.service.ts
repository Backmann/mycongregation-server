import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
  ) {}

  /** Responsibilities that may manage the local-needs backlog. */
  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.SECRETARY,
  ];

  private async assertCanManage(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(LocalNeedsService.MANAGER_RESPONSIBILITIES),
      },
    });
    if (held === 0) {
      throw new ForbiddenException('Not allowed to manage local needs');
    }
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
  ): Promise<LocalNeedsTopic[]> {
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

  async findOne(tenantId: string, id: string): Promise<LocalNeedsTopic> {
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
    return this.repo.save(entity);
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
    Object.assign(found, dto);
    return this.repo.save(found);
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
    return this.findOne(tenantId, id);
  }
}
