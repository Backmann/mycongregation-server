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

  async findOne(tenantId: string, id: string): Promise<ServiceGroup> {
    const group = await this.serviceGroupsRepo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!group) {
      throw new NotFoundException('Service group not found');
    }
    return group;
  }

  async create(
    tenantId: string,
    dto: CreateServiceGroupDto,
  ): Promise<ServiceGroup> {
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
    return this.serviceGroupsRepo.save(group);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateServiceGroupDto,
  ): Promise<ServiceGroup> {
    const group = await this.findOne(tenantId, id);
    if (dto.overseerPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.overseerPublisherId);
    }
    if (dto.assistantPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.assistantPublisherId);
    }
    Object.assign(group, dto);
    return this.serviceGroupsRepo.save(group);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const group = await this.findOne(tenantId, id);
    if (group.deletedAt) {
      throw new BadRequestException('Service group already removed');
    }
    await this.serviceGroupsRepo.softDelete(id);
  }

  async restore(tenantId: string, id: string): Promise<ServiceGroup> {
    const group = await this.findOne(tenantId, id);
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
    await this.findOne(tenantId, id);
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
