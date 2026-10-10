import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import { CreateFieldServiceMeetingDto } from './dto/create-field-service-meeting.dto';
import { UpdateFieldServiceMeetingDto } from './dto/update-field-service-meeting.dto';
import { QueryFieldServiceMeetingsDto } from './dto/query-field-service-meetings.dto';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';

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

const LOCALE: Record<SupportedLanguage, string> = {
  ru: 'ru-RU',
  en: 'en-GB',
  de: 'de-DE',
};

/** «Сб 7 нояб.» in the reader's language. */
function fmtDayShort(iso: string, lang: SupportedLanguage): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** «ноябрь 2026» in the reader's language. */
function fmtMonth(
  year: number,
  month: number,
  lang: SupportedLanguage,
): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

const PUBLISH_TEXTS: Record<
  SupportedLanguage,
  { title: string; intro: string; assistant: string; visit: string }
> = {
  ru: {
    title: 'Встречи для проповеди',
    intro: 'Вы ведёте встречи — {month}:',
    assistant: 'помощник на посещении',
    visit: 'посещение группы',
  },
  en: {
    title: 'Field service meetings',
    intro: 'You conduct meetings — {month}:',
    assistant: 'assistant on the visit',
    visit: 'group visit',
  },
  de: {
    title: 'Zusammenkünfte für den Predigtdienst',
    intro: 'Du leitest Zusammenkünfte — {month}:',
    assistant: 'Gehilfe beim Besuch',
    visit: 'Gruppenbesuch',
  },
};

export interface PublishMonthResult {
  /** Drafts of that month turned into announced meetings. */
  published: number;
  /** People told — one message each, whatever the number of their dates. */
  notified: number;
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
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    @InjectRepository(ServiceGroup)
    private readonly groupsRepo: Repository<ServiceGroup>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  /**
   * May this person see a DRAFT — the same people who may write one: an
   * administrator, the service overseer, his assistant. The same test the
   * guard on POST/PATCH/DELETE makes; it is repeated here because reading is
   * open to everybody and only the drafts are not.
   */
  async canPlan(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([
          ResponsibilityType.SERVICE_OVERSEER,
          ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
        ]),
      },
    });
    return held > 0;
  }

  /**
   * A meeting already held is a record, not a plan.
   *
   * The same rule the duties of a past meeting, a finished circuit visit and
   * the Memorial already follow, in the same words: the day is the
   * CONGREGATION'S, today itself is still open (the meeting may not have
   * started), and the refusal is written to the journal under the reason the
   * journal already names — «встреча уже прошла».
   *
   * Until 9 October 2026 nothing stopped it: a meeting could be created on a
   * day already gone, and last month's could be edited or deleted — deleting
   * one even sent its conductor «встреча отменена» about a Saturday long past.
   */
  private async assertNotHeld(
    congregationId: string,
    dateISO: string,
    entityId: string | null,
  ): Promise<void> {
    if (dateISO >= (await this.clock.todayFor(congregationId))) return;
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'field_service_meeting',
      entityId: entityId ?? congregationId,
      action: 'DENY',
      detail: { reason: 'past_frozen', date: dateISO },
    });
    throw new ConflictException(
      'This field service meeting is on a day already past; it is part of the record and can no longer be changed.',
    );
  }

  /**
   * Everything a meeting points at belongs to THIS congregation, and the
   * conductor is one the congregation allows to conduct.
   *
   * Found on the stand, 9 October 2026: a week starting on a Wednesday was
   * accepted (the meeting then sat on a day nobody chose, invisible to every
   * by-week lookup); a conductor who does not exist came back as «Internal
   * server error»; an assistant who does not exist was stored without a word —
   * that column has no link to the cards at all; a meeting both general and
   * a group's, or a visit with no group, hit the database's own rule and came
   * back as «Internal server error» as well. Each is now refused here, in
   * words, before anything is written.
   *
   * Only what CHANGES is checked against the card switch «Проводит встречу
   * для проповеди»: switching it off for a brother must not lock the meetings
   * he already has — they stay editable, he is simply not assigned anew. The
   * service overseer conducting his own visit is not held to the switch: the
   * visit is his by appointment.
   */
  private async assertConsistent(
    congregationId: string,
    next: {
      conductorPublisherId: string | null;
      isGeneral: boolean;
      serviceGroupId: string | null;
      serviceOverseerVisit: boolean;
      serviceOverseerPublisherId: string | null;
      serviceOverseerAssistantId: string | null;
    },
    prev?: FieldServiceMeeting,
  ): Promise<void> {
    if (next.isGeneral && next.serviceGroupId) {
      throw new BadRequestException(
        'A meeting is either for the whole congregation or for one group, not both.',
      );
    }
    if (next.serviceOverseerVisit && !next.serviceGroupId) {
      throw new BadRequestException(
        "A service overseer's visit is to a group; choose the group.",
      );
    }
    const changed = <K extends keyof typeof next>(k: K) =>
      next[k] !== null && (!prev || prev[k] !== next[k]);

    if (changed('serviceGroupId')) {
      const group = await this.groupsRepo.findOne({
        where: { id: next.serviceGroupId!, congregationId },
      });
      if (!group) {
        throw new BadRequestException(
          'No such service group in this congregation.',
        );
      }
    }
    const person = (id: string) =>
      this.publishersRepo.findOne({ where: { id, congregationId } });
    for (const k of [
      'serviceOverseerPublisherId',
      'serviceOverseerAssistantId',
    ] as const) {
      if (changed(k) && !(await person(next[k]!))) {
        throw new BadRequestException(
          'No such publisher in this congregation.',
        );
      }
    }
    if (changed('conductorPublisherId')) {
      const conductor = await person(next.conductorPublisherId!);
      if (!conductor) {
        throw new BadRequestException(
          'No such publisher in this congregation.',
        );
      }
      const ownVisit =
        next.serviceOverseerVisit &&
        next.conductorPublisherId === next.serviceOverseerPublisherId;
      if (
        !ownVisit &&
        (!conductor.isActive ||
          conductor.capabilities?.fs_meeting_conductor !== true)
      ) {
        throw new BadRequestException(
          'This publisher is not marked as one who conducts field service meetings.',
        );
      }
    }
  }

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
      // No dedupe key: a meeting edited twice is two pieces of news, and the
      // conductor should hear both.
      await this.notifications.notify({
        tenantId: congregationId,
        userIds: [pub.userId],
        title: texts.title,
        body,
        kind: 'field_service_meeting',
        // His own assignment: with no device to take it, it goes by post.
        emailFallback: true,
        data: {
          type: 'field_service_meeting',
          meetingId: meeting.id,
          date: meetingDateISO(meeting),
        },
      });
    } catch (e) {
      this.logger.warn(
        `conductor push failed (${kind}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * `drafts` — include the meetings not yet announced. The controller passes
   * it only for a reader who may plan AND asked for them: an app that does
   * not know what a draft is never sees one, so a phone with last month's
   * version keeps showing exactly the announced schedule.
   */
  list(
    congregationId: string,
    query: QueryFieldServiceMeetingsDto,
    drafts = false,
  ): Promise<FieldServiceMeeting[]> {
    const qb = this.repo
      .createQueryBuilder('m')
      .where('m.congregationId = :congregationId', { congregationId });
    if (!drafts) qb.andWhere('m.publishedAt IS NOT NULL');
    // With an upper bound this reads as a span; without one it stays the
    // exact week it has always been, so no existing caller changes behaviour.
    //
    // NOTE: with NEITHER bound the whole history comes back. Harmless while
    // there are a few dozen rows, and left alone here because callers already
    // rely on it — but it will not stay harmless for ever.
    if (query.weekStart && query.weekEnd) {
      qb.andWhere('m.weekStartDate >= :weekStart', {
        weekStart: query.weekStart,
      }).andWhere('m.weekStartDate < :weekEnd', { weekEnd: query.weekEnd });
    } else if (query.weekStart) {
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
    // Every by-week lookup — the week view, the double-booking warning, the
    // generator's «already there» — keys on the Monday. Another day here puts
    // the meeting on a date nobody chose and hides it from all of them.
    const monday = new Date(`${dto.weekStartDate.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(monday.getTime()) || monday.getUTCDay() !== 1) {
      throw new BadRequestException('weekStartDate must be a Monday.');
    }
    const weekStartDate = dto.weekStartDate.slice(0, 10);
    await this.assertNotHeld(
      congregationId,
      addDaysISO(weekStartDate, dto.dayOfWeek - 1),
      null,
    );
    await this.assertConsistent(congregationId, {
      conductorPublisherId: dto.conductorPublisherId ?? null,
      isGeneral: dto.isGeneral ?? false,
      serviceGroupId: dto.serviceGroupId ?? null,
      serviceOverseerVisit: dto.serviceOverseerVisit ?? false,
      serviceOverseerPublisherId: dto.serviceOverseerPublisherId ?? null,
      serviceOverseerAssistantId: dto.serviceOverseerAssistantId ?? null,
    });
    const entity = this.repo.create({
      congregationId,
      weekStartDate,
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      address: dto.address,
      conductorPublisherId: dto.conductorPublisherId ?? null,
      topic: dto.topic ?? null,
      sourceUrl: dto.sourceUrl ?? null,
      isGeneral: dto.isGeneral ?? false,
      serviceGroupId: dto.serviceGroupId ?? null,
      serviceOverseerVisit: dto.serviceOverseerVisit ?? false,
      serviceOverseerPublisherId: dto.serviceOverseerPublisherId ?? null,
      serviceOverseerAssistantId: dto.serviceOverseerAssistantId ?? null,
      // Made by hand it is announced at once, as it always was. Only a caller
      // that is adding to a month still being prepared asks for a draft.
      publishedAt: dto.draft ? null : new Date(),
    });
    const saved = await this.repo.save(entity);
    // Nobody is told about a draft: the whole month is announced at once, by
    // publishMonth, one message per person. Until then the schedule may still
    // change under him, and three messages about one Saturday is how people
    // learn to ignore the fourth.
    const tell = dto.notifyConductor !== false && saved.publishedAt !== null;
    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'field_service_meeting',
      entityId: saved.id,
      // The conductor is who the entry is ABOUT — that is the name a reader
      // looks for when asking who was put on which meeting.
      subjectId: saved.conductorPublisherId,
      after: {
        weekStartDate: saved.weekStartDate,
        dayOfWeek: saved.dayOfWeek,
        startTime: saved.startTime,
        address: saved.address,
        conductorPublisherId: saved.conductorPublisherId,
        topic: saved.topic,
        isGeneral: saved.isGeneral,
        draft: saved.publishedAt === null,
      },
    });
    if (saved.conductorPublisherId && tell) {
      await this.notifyConductor(
        congregationId,
        saved,
        'assigned',
        saved.conductorPublisherId,
      );
    }
    // The overseer's assistant is told as well. He goes to that group on that
    // day like anyone else assigned, and until now only the man conducting
    // heard about it — so the assistant learned of his own evening by chance.
    if (
      saved.serviceOverseerVisit &&
      saved.serviceOverseerAssistantId &&
      saved.serviceOverseerAssistantId !== saved.conductorPublisherId &&
      tell
    ) {
      await this.notifyConductor(
        congregationId,
        saved,
        'assigned',
        saved.serviceOverseerAssistantId,
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
    // Held already — or being moved onto a day already gone.
    await this.assertNotHeld(congregationId, meetingDateISO(entity), entity.id);
    if (dto.dayOfWeek !== undefined && dto.dayOfWeek !== entity.dayOfWeek) {
      await this.assertNotHeld(
        congregationId,
        addDaysISO(entity.weekStartDate, dto.dayOfWeek - 1),
        entity.id,
      );
    }
    const pick = <T>(v: T | undefined, cur: T): T =>
      v === undefined ? cur : v;
    await this.assertConsistent(
      congregationId,
      {
        conductorPublisherId:
          pick(dto.conductorPublisherId, entity.conductorPublisherId) ?? null,
        isGeneral: pick(dto.isGeneral, entity.isGeneral),
        serviceGroupId: pick(dto.serviceGroupId, entity.serviceGroupId) ?? null,
        serviceOverseerVisit: pick(
          dto.serviceOverseerVisit,
          entity.serviceOverseerVisit,
        ),
        serviceOverseerPublisherId:
          pick(
            dto.serviceOverseerPublisherId,
            entity.serviceOverseerPublisherId,
          ) ?? null,
        serviceOverseerAssistantId:
          pick(
            dto.serviceOverseerAssistantId,
            entity.serviceOverseerAssistantId,
          ) ?? null,
      },
      entity,
    );
    const prevConductorId = entity.conductorPublisherId;
    const prevAssistantId = entity.serviceOverseerAssistantId;
    // Snapshot taken BEFORE the mutations below — the entity is edited in
    // place, so reading it afterwards would compare a value with itself.
    const before = {
      dayOfWeek: entity.dayOfWeek,
      startTime: entity.startTime,
      address: entity.address,
      conductorPublisherId: entity.conductorPublisherId,
      topic: entity.topic,
      isGeneral: entity.isGeneral,
      serviceGroupId: entity.serviceGroupId,
      serviceOverseerVisit: entity.serviceOverseerVisit,
      serviceOverseerPublisherId: entity.serviceOverseerPublisherId,
      serviceOverseerAssistantId: entity.serviceOverseerAssistantId,
    };
    if (dto.dayOfWeek !== undefined) entity.dayOfWeek = dto.dayOfWeek;
    if (dto.startTime !== undefined) entity.startTime = dto.startTime;
    if (dto.address !== undefined) entity.address = dto.address;
    if (dto.conductorPublisherId !== undefined) {
      entity.conductorPublisherId = dto.conductorPublisherId ?? null;
    }
    if (dto.topic !== undefined) entity.topic = dto.topic ?? null;
    if (dto.sourceUrl !== undefined) entity.sourceUrl = dto.sourceUrl ?? null;
    if (dto.isGeneral !== undefined) entity.isGeneral = dto.isGeneral;
    if (dto.serviceGroupId !== undefined) {
      entity.serviceGroupId = dto.serviceGroupId ?? null;
    }
    if (dto.serviceOverseerVisit !== undefined) {
      entity.serviceOverseerVisit = dto.serviceOverseerVisit;
    }
    if (dto.serviceOverseerPublisherId !== undefined) {
      entity.serviceOverseerPublisherId =
        dto.serviceOverseerPublisherId ?? null;
    }
    if (dto.serviceOverseerAssistantId !== undefined) {
      entity.serviceOverseerAssistantId =
        dto.serviceOverseerAssistantId ?? null;
    }
    const saved = await this.repo.save(entity);
    // A draft changes in silence; see create().
    const tell = dto.notifyConductor !== false && saved.publishedAt !== null;
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'field_service_meeting',
      entityId: saved.id,
      subjectId: saved.conductorPublisherId ?? prevConductorId,
      before,
      after: {
        dayOfWeek: saved.dayOfWeek,
        startTime: saved.startTime,
        address: saved.address,
        conductorPublisherId: saved.conductorPublisherId,
        topic: saved.topic,
        isGeneral: saved.isGeneral,
        serviceGroupId: saved.serviceGroupId,
        serviceOverseerVisit: saved.serviceOverseerVisit,
        serviceOverseerPublisherId: saved.serviceOverseerPublisherId,
        serviceOverseerAssistantId: saved.serviceOverseerAssistantId,
      },
      fields: [
        'dayOfWeek',
        'startTime',
        'address',
        'conductorPublisherId',
        'topic',
        'isGeneral',
        'serviceGroupId',
        'serviceOverseerVisit',
        'serviceOverseerPublisherId',
        'serviceOverseerAssistantId',
      ],
    });
    // Told when he becomes the assistant, and told when he stops being one:
    // a person who was expecting to go should hear that he is not.
    if (tell && prevAssistantId !== saved.serviceOverseerAssistantId) {
      if (prevAssistantId && prevAssistantId !== saved.conductorPublisherId) {
        await this.notifyConductor(
          congregationId,
          saved,
          'unassigned',
          prevAssistantId,
        );
      }
      if (
        saved.serviceOverseerVisit &&
        saved.serviceOverseerAssistantId &&
        saved.serviceOverseerAssistantId !== saved.conductorPublisherId
      ) {
        await this.notifyConductor(
          congregationId,
          saved,
          'assigned',
          saved.serviceOverseerAssistantId,
        );
      }
    }
    if (tell && prevConductorId !== saved.conductorPublisherId) {
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
    await this.assertNotHeld(congregationId, meetingDateISO(entity), entity.id);
    await this.repo.delete({ id, congregationId });
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'field_service_meeting',
      entityId: id,
      action: 'DELETE',
      subjectId: entity.conductorPublisherId,
      // Enough to recognise WHICH meeting vanished: the row itself is gone.
      detail: {
        weekStartDate: entity.weekStartDate,
        startTime: entity.startTime,
        address: entity.address,
        draft: entity.publishedAt === null,
      },
    });
    // A draft nobody was told about is not «cancelled» for anybody.
    if (entity.publishedAt === null) return;
    if (entity.conductorPublisherId) {
      await this.notifyConductor(
        congregationId,
        entity,
        'cancelled',
        entity.conductorPublisherId,
      );
    }
    // The overseer's assistant is told too. He was going to that group on that
    // day, and cancelling the evening in silence leaves him to arrive for a
    // meeting that no longer exists. He was told when he was appointed and
    // when he was removed; being told when the whole thing is called off is
    // the same courtesy.
    if (
      entity.serviceOverseerVisit &&
      entity.serviceOverseerAssistantId &&
      entity.serviceOverseerAssistantId !== entity.conductorPublisherId
    ) {
      await this.notifyConductor(
        congregationId,
        entity,
        'cancelled',
        entity.serviceOverseerAssistantId,
      );
    }
  }

  /**
   * Announce a month: every draft whose day falls in it becomes a meeting the
   * congregation can see, and each person concerned hears ONCE, with all of
   * his dates in one message — the conductor of each meeting, and on a
   * visit the overseer and his assistant as well.
   *
   * Why by month and not by draft: the service overseer prepares a month,
   * reads it over, moves a Saturday, fills a gap — and only then says «so».
   * Announcing each change as it was made is what the old way did, and a
   * brother put on, taken off and put back got three messages about one
   * morning. The month is one piece of news.
   *
   * A draft of ANOTHER month stays a draft: December prepared early is not
   * announced by publishing November.
   *
   * Meetings already past are not published either: a draft that was never
   * announced before its day is a plan that did not happen, and announcing
   * it now would tell a brother he «conducts» last Saturday. They stay as
   * they are, for the overseer to delete or leave.
   */
  async publishMonth(
    congregationId: string,
    year: number,
    month: number,
  ): Promise<PublishMonthResult> {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const next =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const today = await this.clock.todayFor(congregationId);
    // The month's weeks, with a margin: the week holding the 1st may start in
    // the previous month and the week holding the 31st end in the next.
    const drafts = (
      await this.repo
        .createQueryBuilder('m')
        .where('m.congregationId = :congregationId', { congregationId })
        .andWhere('m.publishedAt IS NULL')
        .andWhere('m.weekStartDate >= :from', { from: addDaysISO(first, -6) })
        .andWhere('m.weekStartDate < :to', { to: next })
        .getMany()
    ).filter((m) => {
      const d = meetingDateISO(m);
      return d >= first && d < next && d >= today;
    });
    if (drafts.length === 0) return { published: 0, notified: 0 };

    const now = new Date();
    await this.repo.update(
      { id: In(drafts.map((m) => m.id)) },
      { publishedAt: now },
    );
    // The journal has no PUBLISH action; as the Memorial does, the month's
    // announcement is the one UPDATE of `publishedAt`, with its dates.
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'field_service_meeting',
      entityId: drafts[0].id,
      before: { publishedAt: null, published: null },
      after: {
        publishedAt: now.toISOString(),
        published: JSON.stringify({
          year,
          month,
          count: drafts.length,
          dates: drafts.map(meetingDateISO).sort(),
        }),
      },
      fields: ['publishedAt', 'published'],
    });

    // Who hears what: one list of lines per person.
    type Line = {
      date: string;
      time: string;
      address: string;
      groupId: string | null;
      role: 'conductor' | 'overseer' | 'assistant';
    };
    const byPerson = new Map<string, Line[]>();
    const add = (pid: string | null, line: Line) => {
      if (!pid) return;
      const list = byPerson.get(pid) ?? [];
      list.push(line);
      byPerson.set(pid, list);
    };
    for (const m of drafts) {
      const base = {
        date: meetingDateISO(m),
        time: m.startTime,
        address: m.address,
        groupId: m.serviceGroupId,
      };
      add(m.conductorPublisherId, { ...base, role: 'conductor' });
      if (m.serviceOverseerVisit) {
        if (m.serviceOverseerPublisherId !== m.conductorPublisherId) {
          add(m.serviceOverseerPublisherId, { ...base, role: 'overseer' });
        }
        if (m.serviceOverseerAssistantId !== m.conductorPublisherId) {
          add(m.serviceOverseerAssistantId, { ...base, role: 'assistant' });
        }
      }
    }
    if (byPerson.size === 0) return { published: drafts.length, notified: 0 };

    const groupIds = [
      ...new Set(drafts.map((m) => m.serviceGroupId).filter(Boolean)),
    ] as string[];
    const groups = groupIds.length
      ? await this.groupsRepo.find({
          where: { congregationId, id: In(groupIds) },
        })
      : [];
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const people = await this.publishersRepo.find({
      where: { congregationId, id: In([...byPerson.keys()]) },
    });

    let notified = 0;
    for (const person of people) {
      if (!person.userId) continue;
      const lines = (byPerson.get(person.id) ?? []).sort((a, b) =>
        a.date === b.date
          ? a.time.localeCompare(b.time)
          : a.date.localeCompare(b.date),
      );
      const firstLine = lines[0];
      const firstMeeting = drafts.find(
        (m) => meetingDateISO(m) === firstLine.date,
      );
      try {
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: [person.userId],
          kind: 'field_service_meeting',
          text: (lang) => {
            const t = PUBLISH_TEXTS[lang];
            const body = lines
              .map((l) => {
                const group = l.groupId ? groupName.get(l.groupId) : null;
                const where = group
                  ? l.address
                    ? `${group} · ${l.address}`
                    : group
                  : l.address;
                const role =
                  l.role === 'assistant'
                    ? ` (${t.assistant})`
                    : l.role === 'overseer'
                      ? ` (${t.visit})`
                      : '';
                return `${fmtDayShort(l.date, lang)}, ${l.time} — ${where}${role}`;
              })
              .join('\n');
            return {
              title: t.title,
              body: `${t.intro.replace('{month}', fmtMonth(year, month, lang))}\n${body}`,
            };
          },
          // His own assignments: with no device to take them, they go by post.
          emailFallback: true,
          data: {
            type: 'field_service_meeting',
            meetingId: firstMeeting?.id ?? drafts[0].id,
            date: firstLine.date,
          },
        });
        notified += 1;
      } catch (e) {
        this.logger.warn(
          `publish notice failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { published: drafts.length, notified };
  }

  /**
   * Per-conductor rotation summary across ALL assigned meetings — past and
   * future. `lastDate` is the most recent meeting already held; `nextDate` is
   * the soonest upcoming one. Helps spread the load fairly.
   */
  async conductorStats(congregationId: string): Promise<ConductorStat[]> {
    const meetings = await this.repo.find({ where: { congregationId } });
    const today = await this.clock.todayFor(congregationId);
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
