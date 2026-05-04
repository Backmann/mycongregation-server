import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { CreatePublisherDto } from './dto/create-publisher.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';
import { QueryPublishersDto } from './dto/query-publishers.dto';
import { RemovePublisherDto } from './dto/remove-publisher.dto';

@Injectable()
export class PublishersService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
  ) {}

  async findAll(tenantId: string, query: QueryPublishersDto) {
    const qb = this.publishersRepo
      .createQueryBuilder('publisher')
      .where('publisher.congregation_id = :tenantId', { tenantId });

    if (query.includeRemoved) {
      qb.withDeleted();
    }

    if (query.familyId) {
      qb.andWhere('publisher.family_id = :familyId', {
        familyId: query.familyId,
      });
    }
    if (query.serviceGroupId) {
      qb.andWhere('publisher.service_group_id = :sgId', {
        sgId: query.serviceGroupId,
      });
    }
    if (query.appointment) {
      qb.andWhere('publisher.appointment = :appointment', {
        appointment: query.appointment,
      });
    }
    if (query.pioneerType) {
      qb.andWhere('publisher.pioneer_type = :pioneerType', {
        pioneerType: query.pioneerType,
      });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('publisher.is_active = :isActive', {
        isActive: query.isActive,
      });
    }

    if (query.search) {
      const pattern = `%${query.search}%`;
      qb.andWhere(
        new Brackets((b) => {
          b.where('publisher.first_name ILIKE :pattern', { pattern })
            .orWhere('publisher.last_name ILIKE :pattern', { pattern })
            .orWhere('publisher.middle_name ILIKE :pattern', { pattern })
            .orWhere('publisher.display_name ILIKE :pattern', { pattern });
        }),
      );
    }

    const sortColumn = `publisher.${query.sortBy ?? 'lastName'}`;
    const sortOrder = (query.sortOrder ?? 'asc').toUpperCase() as 'ASC' | 'DESC';
    qb.orderBy(sortColumn, sortOrder);

    qb.take(query.limit ?? 50);
    qb.skip(query.offset ?? 0);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    };
  }

  async findOne(tenantId: string, id: string): Promise<Publisher> {
    const publisher = await this.publishersRepo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found');
    }
    return publisher;
  }

  async create(
    tenantId: string,
    dto: CreatePublisherDto,
  ): Promise<Publisher> {
    const displayName = this.buildDisplayName(
      dto.firstName,
      dto.middleName ?? null,
      dto.lastName,
    );
    const publisher = this.publishersRepo.create({
      ...dto,
      congregationId: tenantId,
      displayName,
    });
    return this.publishersRepo.save(publisher);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePublisherDto,
  ): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    Object.assign(publisher, dto);

    if (
      dto.firstName !== undefined ||
      dto.middleName !== undefined ||
      dto.lastName !== undefined
    ) {
      publisher.displayName = this.buildDisplayName(
        publisher.firstName,
        publisher.middleName,
        publisher.lastName,
      );
    }

    return this.publishersRepo.save(publisher);
  }

  async remove(
    tenantId: string,
    id: string,
    dto: RemovePublisherDto,
  ): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    if (publisher.deletedAt) {
      throw new BadRequestException('Publisher already removed');
    }
    publisher.removalReason = dto.reason;
    publisher.removedNote = dto.note ?? null;
    publisher.removedAt = new Date();
    publisher.restoredAt = null;
    publisher.isActive = false;
    await this.publishersRepo.save(publisher);
    await this.publishersRepo.softDelete(id);
    return this.findOne(tenantId, id);
  }

  async restore(tenantId: string, id: string): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    if (!publisher.deletedAt) {
      throw new BadRequestException('Publisher is not removed');
    }
    await this.publishersRepo.restore(id);
    publisher.restoredAt = new Date();
    publisher.isActive = true;
    publisher.deletedAt = null;
    await this.publishersRepo.save(publisher);
    return this.findOne(tenantId, id);
  }

  /**
   * Russian-style "Фамилия Имя Отчество". Override per-locale later if needed.
   */
  private buildDisplayName(
    firstName: string,
    middleName: string | null,
    lastName: string,
  ): string {
    return [lastName, firstName, middleName].filter(Boolean).join(' ');
  }
}
