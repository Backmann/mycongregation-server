import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Repository } from 'typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { CreateSpecialEventDto } from './dto/create-special-event.dto';
import { UpdateSpecialEventDto } from './dto/update-special-event.dto';
import { QuerySpecialEventsDto } from './dto/query-special-events.dto';
import { CoVisitTemplateService } from './co-visit-template.service';

@Injectable()
export class SpecialEventsService {
  constructor(
    @InjectRepository(SpecialEvent)
    private readonly specialEventsRepo: Repository<SpecialEvent>,
    private readonly coVisitTemplate: CoVisitTemplateService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Lists events for the tenant. By default returns only events that have not
   * finished yet (COALESCE(end_date, date) >= today in Europe/Berlin), so a
   * multi-day event stays visible until its last day. Ordered by start date
   * then time. Pass `all=true` to include past events, `includeRemoved=true`
   * for soft-deleted.
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
      qb.andWhere('COALESCE(e.end_date, e.date) >= :today', { today });
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
    const saved = await this.specialEventsRepo.save(event);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'special_event',
      entityId: saved.id,
      after: {
        title: saved.title,
        type: saved.type,
        date: saved.date,
        endDate: saved.endDate,
        time: saved.time,
        address: saved.address,
      },
    });
    return this.coVisitTemplate.apply(saved);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateSpecialEventDto,
  ): Promise<SpecialEvent> {
    const event = await this.findOne(tenantId, id);
    const prevName = this.coVisitTemplate.displayName(event);
    const before = {
      title: event.title,
      type: event.type,
      date: event.date,
      endDate: event.endDate,
      time: event.time,
      address: event.address,
    };
    Object.assign(event, dto);
    const saved = await this.specialEventsRepo.save(event);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'special_event',
      entityId: saved.id,
      before,
      after: {
        title: saved.title,
        type: saved.type,
        date: saved.date,
        endDate: saved.endDate,
        time: saved.time,
        address: saved.address,
      },
      fields: ['title', 'type', 'date', 'endDate', 'time', 'address'],
    });
    await this.coVisitTemplate.syncSpeaker(saved, prevName);
    return saved;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const event = await this.findOne(tenantId, id);
    await this.coVisitTemplate.revert(event);
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'special_event',
      entityId: id,
      action: 'DELETE',
      detail: { title: event.title, date: event.date },
    });
    await this.specialEventsRepo.softDelete({ id, congregationId: tenantId });
  }

  async restore(tenantId: string, id: string): Promise<SpecialEvent> {
    await this.specialEventsRepo.restore({ id, congregationId: tenantId });
    const event = await this.findOne(tenantId, id);
    return this.coVisitTemplate.apply(event);
  }
}
