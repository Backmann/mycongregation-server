import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { CreateSpecialEventDto } from './dto/create-special-event.dto';
import { UpdateSpecialEventDto } from './dto/update-special-event.dto';
import { QuerySpecialEventsDto } from './dto/query-special-events.dto';

@Injectable()
export class SpecialEventsService {
  constructor(
    @InjectRepository(SpecialEvent)
    private readonly specialEventsRepo: Repository<SpecialEvent>,
  ) {}

  /**
   * Lists events for the tenant. By default returns only upcoming events
   * (date >= today in Europe/Berlin), ordered by date then time. Pass
   * `all=true` to include past events, `includeRemoved=true` for soft-deleted.
   */
  async findAll(
    tenantId: string,
    query: QuerySpecialEventsDto,
  ): Promise<SpecialEvent[]> {
    const qb = this.specialEventsRepo
      .createQueryBuilder('e')
      .where('e.congregation_id = :tenantId', { tenantId });

    if (query.includeRemoved === 'true') {
      qb.withDeleted();
    }

    if (query.all !== 'true') {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Berlin',
      }).format(new Date());
      qb.andWhere('e.date >= :today', { today });
    }

    qb.orderBy('e.date', 'ASC').addOrderBy('e.time', 'ASC');
    return qb.getMany();
  }

  async findOne(tenantId: string, id: string): Promise<SpecialEvent> {
    const event = await this.specialEventsRepo
      .createQueryBuilder('e')
      .withDeleted()
      .where('e.congregation_id = :tenantId', { tenantId })
      .andWhere('e.id = :id', { id })
      .getOne();

    if (!event) {
      throw new NotFoundException('Special event not found');
    }
    return event;
  }

  async create(
    tenantId: string,
    dto: CreateSpecialEventDto,
  ): Promise<SpecialEvent> {
    const event = this.specialEventsRepo.create({
      ...dto,
      congregationId: tenantId,
    });
    return this.specialEventsRepo.save(event);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateSpecialEventDto,
  ): Promise<SpecialEvent> {
    const event = await this.findOne(tenantId, id);
    Object.assign(event, dto);
    return this.specialEventsRepo.save(event);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.specialEventsRepo.softDelete({ id, congregationId: tenantId });
  }

  async restore(tenantId: string, id: string): Promise<SpecialEvent> {
    await this.specialEventsRepo.restore({ id, congregationId: tenantId });
    return this.findOne(tenantId, id);
  }
}
