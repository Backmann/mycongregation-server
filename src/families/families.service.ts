import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Family } from '../entities/family.entity';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { QueryFamiliesDto } from './dto/query-families.dto';
import { PublishersService } from '../publishers/publishers.service';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';

@Injectable()
export class FamiliesService {
  constructor(
    @InjectRepository(Family)
    private readonly familiesRepo: Repository<Family>,
    private readonly publishersService: PublishersService,
  ) {}

  async findAll(tenantId: string, query: QueryFamiliesDto) {
    const qb = this.familiesRepo
      .createQueryBuilder('family')
      .where('family.congregation_id = :tenantId', { tenantId });

    if (query.includeRemoved) {
      qb.withDeleted();
    }

    if (query.search) {
      const pattern = `%${query.search}%`;
      qb.andWhere(
        new Brackets((b) => {
          b.where('family.name ILIKE :pattern', { pattern });
        }),
      );
    }

    const sortColumn = `family.${query.sortBy ?? 'name'}`;
    const sortOrder = (query.sortOrder ?? 'asc').toUpperCase() as 'ASC' | 'DESC';
    qb.orderBy(sortColumn, sortOrder);

    qb.take(query.limit ?? 50);
    qb.skip(query.offset ?? 0);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit: query.limit ?? 50, offset: query.offset ?? 0 };
  }

  async findOne(tenantId: string, id: string): Promise<Family> {
    const family = await this.familiesRepo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!family) {
      throw new NotFoundException('Family not found');
    }
    return family;
  }

  async create(tenantId: string, dto: CreateFamilyDto): Promise<Family> {
    if (dto.headPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.headPublisherId);
    }
    const family = this.familiesRepo.create({
      ...dto,
      congregationId: tenantId,
    });
    return this.familiesRepo.save(family);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateFamilyDto,
  ): Promise<Family> {
    const family = await this.findOne(tenantId, id);
    if (dto.headPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.headPublisherId);
    }
    Object.assign(family, dto);
    return this.familiesRepo.save(family);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const family = await this.findOne(tenantId, id);
    if (family.deletedAt) {
      throw new BadRequestException('Family already removed');
    }
    await this.familiesRepo.softDelete(id);
  }

  async restore(tenantId: string, id: string): Promise<Family> {
    const family = await this.findOne(tenantId, id);
    if (!family.deletedAt) {
      throw new BadRequestException('Family is not removed');
    }
    await this.familiesRepo.restore(id);
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
      familyId: id,
    });
  }

  private async ensurePublisherInTenant(
    tenantId: string,
    publisherId: string,
  ): Promise<void> {
    // findOne throws NotFoundException if publisher missing or in another tenant
    await this.publishersService.findOne(tenantId, publisherId);
  }
}
