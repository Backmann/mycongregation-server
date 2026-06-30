import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { CreateFieldServiceMeetingDto } from './dto/create-field-service-meeting.dto';
import { UpdateFieldServiceMeetingDto } from './dto/update-field-service-meeting.dto';
import { QueryFieldServiceMeetingsDto } from './dto/query-field-service-meetings.dto';

/** Add n days to an ISO 'YYYY-MM-DD' date (UTC, calendar-safe). */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Actual calendar date (ISO) of a meeting, from its week start + weekday. */
function meetingDateISO(m: FieldServiceMeeting): string {
  return addDaysISO(m.weekStartDate, m.dayOfWeek - 1);
}

export interface ConductorStat {
  conductorPublisherId: string;
  total: number;
  lastDate: string | null; // most recent past meeting (<= today)
  nextDate: string | null; // soonest upcoming meeting (> today)
}

export interface TopicHistoryEntry {
  topic: string;
  lastDate: string;
}

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
      isGeneral: dto.isGeneral ?? false,
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
    if (dto.isGeneral !== undefined) entity.isGeneral = dto.isGeneral;
    return this.repo.save(entity);
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const res = await this.repo.delete({ id, congregationId });
    if (!res.affected) {
      throw new NotFoundException('Field service meeting not found');
    }
  }

  /**
   * Per-conductor rotation summary across ALL assigned meetings — past and
   * future. `lastDate` is the most recent meeting already held; `nextDate` is
   * the soonest upcoming one. Helps spread the load fairly.
   */
  async conductorStats(congregationId: string): Promise<ConductorStat[]> {
    const meetings = await this.repo.find({ where: { congregationId } });
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<
      string,
      { total: number; lastDate: string | null; nextDate: string | null }
    >();
    for (const m of meetings) {
      if (!m.conductorPublisherId) continue;
      const d = meetingDateISO(m);
      const e = map.get(m.conductorPublisherId) ?? {
        total: 0,
        lastDate: null,
        nextDate: null,
      };
      e.total += 1;
      if (d <= today) {
        if (!e.lastDate || d > e.lastDate) e.lastDate = d;
      } else {
        if (!e.nextDate || d < e.nextDate) e.nextDate = d;
      }
      map.set(m.conductorPublisherId, e);
    }
    return [...map.entries()].map(([conductorPublisherId, e]) => ({
      conductorPublisherId,
      ...e,
    }));
  }

  /**
   * Distinct meeting topics with the most recent date each was used. Lets the
   * UI flag "this topic was already used on …" when a topic is re-entered.
   */
  async topicHistory(congregationId: string): Promise<TopicHistoryEntry[]> {
    const meetings = await this.repo.find({ where: { congregationId } });
    const map = new Map<string, TopicHistoryEntry>();
    for (const m of meetings) {
      const topic = (m.topic ?? '').trim();
      if (!topic) continue;
      const key = topic.toLowerCase();
      const d = meetingDateISO(m);
      const e = map.get(key);
      if (!e) {
        map.set(key, { topic, lastDate: d });
      } else if (d > e.lastDate) {
        e.lastDate = d;
        e.topic = topic;
      }
    }
    return [...map.values()];
  }
}
