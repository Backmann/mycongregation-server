import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { CreateFieldServiceMeetingDto } from './dto/create-field-service-meeting.dto';
import { UpdateFieldServiceMeetingDto } from './dto/update-field-service-meeting.dto';
import { QueryFieldServiceMeetingsDto } from './dto/query-field-service-meetings.dto';
import { Publisher } from '../entities/publisher.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

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

type PushLang = 'ru' | 'en' | 'de';
type ConductorPushKind = 'assigned' | 'unassigned' | 'cancelled';

const PUSH_TEXTS: Record<
  PushLang,
  { title: string } & Record<ConductorPushKind, string>
> = {
  ru: {
    title: 'Встреча для проповеди',
    assigned: 'Вы ведёте встречу: {date}, {time} — {address}',
    unassigned: 'Вы больше не ведёте встречу {date}, {time}',
    cancelled: 'Встреча {date}, {time} отменена',
  },
  en: {
    title: 'Field service meeting',
    assigned: 'You conduct the meeting: {date}, {time} — {address}',
    unassigned: 'You no longer conduct the meeting on {date}, {time}',
    cancelled: 'The meeting on {date}, {time} was cancelled',
  },
  de: {
    title: 'Zusammenkunft für den Predigtdienst',
    assigned: 'Du leitest die Zusammenkunft: {date}, {time} — {address}',
    unassigned: 'Du leitest die Zusammenkunft am {date}, {time} nicht mehr',
    cancelled: 'Die Zusammenkunft am {date}, {time} wurde abgesagt',
  },
};

/** ISO YYYY-MM-DD -> DD.MM.YYYY. */
function fmtDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

@Injectable()
export class FieldServiceMeetingsService {
  private readonly logger = new Logger(FieldServiceMeetingsService.name);

  constructor(
    @InjectRepository(FieldServiceMeeting)
    private readonly repo: Repository<FieldServiceMeeting>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly push: PushNotificationsService,
  ) {}

  /**
   * Push-notify a conductor about being assigned to / removed from a meeting
   * (or the meeting being cancelled). Best-effort: a push failure never fails
   * the request. Skipped silently when the publisher has no linked login.
   */
  private async notifyConductor(
    congregationId: string,
    meeting: FieldServiceMeeting,
    kind: ConductorPushKind,
    publisherId: string,
  ): Promise<void> {
    try {
      const pub = await this.publishersRepo.findOne({
        where: { id: publisherId, congregationId },
        relations: { user: true },
      });
      if (!pub?.userId) return;
      const lang = (
        ['ru', 'en', 'de'].includes(pub.user?.uiLanguage ?? '')
          ? pub.user!.uiLanguage
          : 'ru'
      ) as PushLang;
      const texts = PUSH_TEXTS[lang];
      const body = texts[kind]
        .replace('{date}', fmtDate(meetingDateISO(meeting)))
        .replace('{time}', meeting.startTime)
        .replace('{address}', meeting.address);
      await this.push.sendToUsers(
        congregationId,
        [pub.userId],
        texts.title,
        body,
        {
          type: 'field_service_meeting',
          meetingId: meeting.id,
          date: meetingDateISO(meeting),
        },
      );
    } catch (e) {
      this.logger.warn(
        `conductor push failed (${kind}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

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

  async create(
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
    const saved = await this.repo.save(entity);
    if (saved.conductorPublisherId && dto.notifyConductor !== false) {
      await this.notifyConductor(
        congregationId,
        saved,
        'assigned',
        saved.conductorPublisherId,
      );
    }
    return saved;
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
    const prevConductorId = entity.conductorPublisherId;
    if (dto.dayOfWeek !== undefined) entity.dayOfWeek = dto.dayOfWeek;
    if (dto.startTime !== undefined) entity.startTime = dto.startTime;
    if (dto.address !== undefined) entity.address = dto.address;
    if (dto.conductorPublisherId !== undefined) {
      entity.conductorPublisherId = dto.conductorPublisherId ?? null;
    }
    if (dto.topic !== undefined) entity.topic = dto.topic ?? null;
    if (dto.sourceUrl !== undefined) entity.sourceUrl = dto.sourceUrl ?? null;
    if (dto.isGeneral !== undefined) entity.isGeneral = dto.isGeneral;
    const saved = await this.repo.save(entity);
    if (
      dto.notifyConductor !== false &&
      prevConductorId !== saved.conductorPublisherId
    ) {
      if (prevConductorId) {
        await this.notifyConductor(
          congregationId,
          saved,
          'unassigned',
          prevConductorId,
        );
      }
      if (saved.conductorPublisherId) {
        await this.notifyConductor(
          congregationId,
          saved,
          'assigned',
          saved.conductorPublisherId,
        );
      }
    }
    return saved;
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const entity = await this.repo.findOne({ where: { id, congregationId } });
    if (!entity) {
      throw new NotFoundException('Field service meeting not found');
    }
    await this.repo.delete({ id, congregationId });
    if (entity.conductorPublisherId) {
      await this.notifyConductor(
        congregationId,
        entity,
        'cancelled',
        entity.conductorPublisherId,
      );
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
