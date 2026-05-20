import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ServiceGroup } from '../entities/service-group.entity';
import { CreateServiceGroupDto } from './dto/create-service-group.dto';
import { UpdateServiceGroupDto } from './dto/update-service-group.dto';
import { QueryServiceGroupsDto } from './dto/query-service-groups.dto';
import { PublishersService } from '../publishers/publishers.service';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';

type ResolvedPublisher = Awaited<ReturnType<PublishersService['findOne']>>;

/**
 * A service group enriched with its resolved overseer and assistant
 * publisher records. The entity stores only publisher IDs (no FK relation,
 * see service-group.entity.ts), so leaders are resolved in the service layer
 * and attached here for API responses.
 */
export type ServiceGroupWithLeaders = ServiceGroup & {
  overseer: ResolvedPublisher | null;
  assistant: ResolvedPublisher | null;
};

@Injectable()
export class ServiceGroupsService {
  constructor(
    @InjectRepository(ServiceGroup)
    private readonly serviceGroupsRepo: Repository<ServiceGroup>,
    private readonly publishersService: PublishersService,
  ) {}

  async findAll(tenantId: string, query: QueryServiceGroupsDto) {
    const qb = this.serviceGroupsRepo
      .createQueryBuilder('sg')
      .where('sg.congregation_id = :tenantId', { tenantId });

    if (query.includeRemoved) {
      qb.withDeleted();
    }

    if (query.search) {
      const pattern = `%${query.search}%`;
      qb.andWhere(
        new Brackets((b) => {
          b.where('sg.name ILIKE :pattern', { pattern });
        }),
      );
    }

    const sortColumn = `sg.${query.sortBy ?? 'name'}`;
    const sortOrder = (query.sortOrder ?? 'asc').toUpperCase() as
      | 'ASC'
      | 'DESC';
    qb.orderBy(sortColumn, sortOrder);

    qb.take(query.limit ?? 50);
    qb.skip(query.offset ?? 0);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit: query.limit ?? 50, offset: query.offset ?? 0 };
  }

  /**
   * Raw entity fetch with no leader resolution. Used internally by mutations
   * that need a managed entity to mutate and save.
   */
  private async findEntity(
    tenantId: string,
    id: string,
  ): Promise<ServiceGroup> {
    const group = await this.serviceGroupsRepo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!group) {
      throw new NotFoundException('Service group not found');
    }
    return group;
  }

  /**
   * Resolves the overseer and assistant publisher records for a group and
   * attaches them. Resolution is independent of group membership — an
   * overseer or assistant need not be a member of the group they lead, which
   * is why looking them up in the group's member list (the previous client
   * behaviour) silently dropped non-member leaders. A leader whose publisher
   * record is missing or removed resolves to null rather than throwing.
   */
  private async attachLeaders(
    tenantId: string,
    group: ServiceGroup,
  ): Promise<ServiceGroupWithLeaders> {
    const overseer = group.overseerPublisherId
      ? await this.publishersService
          .findOne(tenantId, group.overseerPublisherId)
          .catch(() => null)
      : null;
    const assistant = group.assistantPublisherId
      ? await this.publishersService
          .findOne(tenantId, group.assistantPublisherId)
          .catch(() => null)
      : null;
    return { ...group, overseer, assistant };
  }

  async findOne(
    tenantId: string,
    id: string,
  ): Promise<ServiceGroupWithLeaders> {
    const group = await this.findEntity(tenantId, id);
    return this.attachLeaders(tenantId, group);
  }

  async create(
    tenantId: string,
    dto: CreateServiceGroupDto,
  ): Promise<ServiceGroupWithLeaders> {
    if (dto.overseerPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.overseerPublisherId);
    }
    if (dto.assistantPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.assistantPublisherId);
    }
    const group = this.serviceGroupsRepo.create({
      ...dto,
      congregationId: tenantId,
    });
    const saved = await this.serviceGroupsRepo.save(group);
    return this.attachLeaders(tenantId, saved);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateServiceGroupDto,
  ): Promise<ServiceGroupWithLeaders> {
    const group = await this.findEntity(tenantId, id);
    if (dto.overseerPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.overseerPublisherId);
    }
    if (dto.assistantPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.assistantPublisherId);
    }
    Object.assign(group, dto);
    const saved = await this.serviceGroupsRepo.save(group);
    return this.attachLeaders(tenantId, saved);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const group = await this.findEntity(tenantId, id);
    if (group.deletedAt) {
      throw new BadRequestException('Service group already removed');
    }
    await this.serviceGroupsRepo.softDelete(id);
  }

  async restore(
    tenantId: string,
    id: string,
  ): Promise<ServiceGroupWithLeaders> {
    const group = await this.findEntity(tenantId, id);
    if (!group.deletedAt) {
      throw new BadRequestException('Service group is not removed');
    }
    await this.serviceGroupsRepo.restore(id);
    return this.findOne(tenantId, id);
  }

  async findPublishers(
    tenantId: string,
    id: string,
    query: QueryPublishersDto,
  ) {
    await this.findEntity(tenantId, id);
    return this.publishersService.findAll(tenantId, {
      ...query,
      serviceGroupId: id,
    });
  }

  private async ensurePublisherInTenant(
    tenantId: string,
    publisherId: string,
  ): Promise<void> {
    await this.publishersService.findOne(tenantId, publisherId);
  }
}
