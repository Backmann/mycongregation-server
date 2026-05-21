import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { CreateFieldServiceMeetingDto } from './dto/create-field-service-meeting.dto';
import { UpdateFieldServiceMeetingDto } from './dto/update-field-service-meeting.dto';
import { QueryFieldServiceMeetingsDto } from './dto/query-field-service-meetings.dto';

@Injectable()
export class FieldServiceMeetingsService {
  constructor(
    @InjectRepository(FieldServiceMeeting)
    private readonly repo: Repository<FieldServiceMeeting>,
  ) {}

  list(
    congregationId: string,
    query: QueryFieldServiceMeetingsDto,
  ): Promise<FieldServiceMeeting[]> {
    const qb = this.repo
      .createQueryBuilder('m')
      .where('m.congregationId = :congregationId', { congregationId });
    if (query.weekStart) {
      qb.andWhere('m.weekStartDate = :weekStart', {
        weekStart: query.weekStart,
      });
    }
    return qb
      .orderBy('m.weekStartDate', 'ASC')
      .addOrderBy('m.dayOfWeek', 'ASC')
      .addOrderBy('m.startTime', 'ASC')
      .getMany();
  }

  create(
    congregationId: string,
    dto: CreateFieldServiceMeetingDto,
  ): Promise<FieldServiceMeeting> {
    const entity = this.repo.create({
      congregationId,
      weekStartDate: dto.weekStartDate,
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      address: dto.address,
      conductorPublisherId: dto.conductorPublisherId ?? null,
      topic: dto.topic ?? null,
      sourceUrl: dto.sourceUrl ?? null,
    });
    return this.repo.save(entity);
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateFieldServiceMeetingDto,
  ): Promise<FieldServiceMeeting> {
    const entity = await this.repo.findOne({
      where: { id, congregationId },
    });
    if (!entity) {
      throw new NotFoundException('Field service meeting not found');
    }
    if (dto.dayOfWeek !== undefined) entity.dayOfWeek = dto.dayOfWeek;
    if (dto.startTime !== undefined) entity.startTime = dto.startTime;
    if (dto.address !== undefined) entity.address = dto.address;
    if (dto.conductorPublisherId !== undefined) {
      entity.conductorPublisherId = dto.conductorPublisherId ?? null;
    }
    if (dto.topic !== undefined) entity.topic = dto.topic ?? null;
    if (dto.sourceUrl !== undefined) entity.sourceUrl = dto.sourceUrl ?? null;
    return this.repo.save(entity);
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const res = await this.repo.delete({ id, congregationId });
    if (!res.affected) {
      throw new NotFoundException('Field service meeting not found');
    }
  }
}
