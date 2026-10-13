import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import { CreateFieldServiceMeetingDto } from './dto/create-field-service-meeting.dto';
import { UpdateFieldServiceMeetingDto } from './dto/update-field-service-meeting.dto';
import { QueryFieldServiceMeetingsDto } from './dto/query-field-service-meetings.dto';
import {
  CancelFieldServiceMeetingDto,
  RestoreFieldServiceMeetingDto,
} from './dto/cancel-field-service-meeting.dto';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { refusal } from '../common/errors/refusal';

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
type ConductorPushKind = 'assigned' | 'unassigned';

const PUSH_TEXTS: Record<
  PushLang,
  { title: string } & Record<ConductorPushKind, string>
> = {
  ru: {
    title: 'Встреча для проповеди',
    assigned: 'Вы ведёте встречу: {date}, {time} — {address}',
    unassigned: 'Вы больше не ведёте встречу {date}, {time}',
  },
  en: {
    title: 'Field service meeting',
    assigned: 'You conduct the meeting: {date}, {time} — {address}',
    unassigned: 'You no longer conduct the meeting on {date}, {time}',
  },
  de: {
    title: 'Zusammenkunft für den Predigtdienst',
    // «Sie», as the app speaks German (decision of 28 September 2026).
    assigned: 'Sie leiten die Zusammenkunft: {date}, {time} — {address}',
    unassigned: 'Sie leiten die Zusammenkunft am {date}, {time} nicht mehr',
  },
};

/** The notice as stored: trimmed, and absent rather than blank. */
function cleanNotice(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  return t.length > 0 ? t : null;
}

/** ISO YYYY-MM-DD -> DD.MM.YYYY. */
function fmtDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

const LOCALE: Record<SupportedLanguage, string> = {
  ru: 'ru-RU',
  en: 'en-GB',
  de: 'de-DE',
};

/** The notice for everyone, in the reader's language. */
const NOTICE_TEXTS: Record<SupportedLanguage, { title: string; body: string }> =
  {
    ru: {
      title: 'Встреча для проповеди — примечание',
      body: '{day}, {time}: {notice}',
    },
    en: {
      title: 'Field service meeting — notice',
      body: '{day}, {time}: {notice}',
    },
    de: {
      title: 'Predigtdienstzusammenkunft — Hinweis',
      body: '{day}, {time}: {notice}',
    },
  };

/**
 * A meeting that MOVED, was called off, or holds again — told to everyone it
 * concerns (13 October 2026). Until now a Saturday moved to Sunday was told
 * to nobody, not even the conductor: he was told only when he himself was
 * put on or taken off. And a meeting deleted vanished from everyone's screen
 * with a word to the conductor alone.
 */
const CHANGE_TEXTS: Record<
  SupportedLanguage,
  {
    movedTitle: string;
    moved: string;
    cancelledTitle: string;
    restoredTitle: string;
  }
> = {
  ru: {
    movedTitle: 'Встреча для проповеди изменена',
    moved: 'Было: {was}\nТеперь: {now}',
    cancelledTitle: 'Встреча для проповеди отменена',
    restoredTitle: 'Встреча для проповеди снова в силе',
  },
  en: {
    movedTitle: 'Field service meeting changed',
    moved: 'Was: {was}\nNow: {now}',
    cancelledTitle: 'Field service meeting cancelled',
    restoredTitle: 'Field service meeting is on again',
  },
  de: {
    movedTitle: 'Predigtdienstzusammenkunft geändert',
    moved: 'Bisher: {was}\nJetzt: {now}',
    cancelledTitle: 'Predigtdienstzusammenkunft abgesagt',
    restoredTitle: 'Predigtdienstzusammenkunft findet wieder statt',
  },
};

/** What a person needs to find the meeting: day, time and — when asked — place. */
interface Where {
  date: string;
  time: string;
  address: string;
}

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
    intro: 'Sie leiten Zusammenkünfte — {month}:',
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
      refusal(
        'FS_PAST_LOCKED',
        'This field service meeting is on a day already past; it is part of the record and can no longer be changed.',
        { date: dateISO },
      ),
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
        refusal(
          'FS_GENERAL_AND_GROUP',
          'A meeting is either for the whole congregation or for one group, not both.',
        ),
      );
    }
    if (next.serviceOverseerVisit && !next.serviceGroupId) {
      throw new BadRequestException(
        refusal(
          'FS_VISIT_NEEDS_GROUP',
          "A service overseer's visit is to a group; choose the group.",
        ),
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
          refusal(
            'NO_SUCH_GROUP',
            'No such service group in this congregation.',
          ),
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
          refusal(
            'NO_SUCH_PUBLISHER',
            'No such publisher in this congregation.',
          ),
        );
      }
    }
    if (changed('conductorPublisherId')) {
      const conductor = await person(next.conductorPublisherId!);
      if (!conductor) {
        throw new BadRequestException(
          refusal(
            'NO_SUCH_PUBLISHER',
            'No such publisher in this congregation.',
          ),
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
          refusal(
            'FS_NOT_A_CONDUCTOR',
            'This publisher is not marked as one who conducts field service meetings.',
          ),
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
   * The people assigned to a meeting — its conductor, and on a visit the
   * overseer and his assistant — by their publisher ids.
   */
  private assignedPublisherIds(meeting: FieldServiceMeeting): string[] {
    const ids = [meeting.conductorPublisherId];
    if (meeting.serviceOverseerVisit) {
      ids.push(
        meeting.serviceOverseerPublisherId,
        meeting.serviceOverseerAssistantId,
      );
    }
    return [...new Set(ids.filter((x): x is string => !!x))];
  }

  /**
   * «Moved», «cancelled», «on again» — one message in each reader's language.
   *
   * Those assigned hear it as their own assignment (by post when they have
   * no device); everyone else the meeting concerns hears it as ministry news,
   * unless the planner switched that off. Keyed by the meeting and what it
   * now IS — so the same change saved twice is one message, while a second,
   * different move the same evening is news again.
   */
  private async notifyChange(
    congregationId: string,
    meeting: FieldServiceMeeting,
    change: {
      kind: 'moved' | 'cancelled' | 'restored';
      was?: Where;
      now?: Where;
      toAssigned: boolean;
      toAudience: boolean;
      skipPublishers?: Set<string>;
    },
  ): Promise<void> {
    try {
      const assignedIds = this.assignedPublisherIds(meeting).filter(
        (id) => !change.skipPublishers?.has(id),
      );
      const people = assignedIds.length
        ? await this.publishersRepo.find({
            where: { congregationId, id: In(assignedIds) },
            select: { id: true, userId: true },
          })
        : [];
      const assignedUsers = people
        .map((p) => p.userId)
        .filter((u): u is string => !!u);
      // Skipped people are not in the audience either: they heard already.
      const skippedUsers = new Set<string>();
      if (change.skipPublishers?.size) {
        const skipped = await this.publishersRepo.find({
          where: { congregationId, id: In([...change.skipPublishers]) },
          select: { id: true, userId: true },
        });
        for (const p of skipped) if (p.userId) skippedUsers.add(p.userId);
      }
      const audienceUsers = change.toAudience
        ? (await this.audienceUserIds(congregationId, meeting)).filter(
            (u) => !assignedUsers.includes(u) && !skippedUsers.has(u),
          )
        : [];

      const date = meetingDateISO(meeting);
      const where = (w: Where, lang: SupportedLanguage, place: boolean) =>
        `${fmtDayShort(w.date, lang)}, ${w.time}` +
        (place ? ` — ${w.address}` : '');
      const text = (lang: SupportedLanguage) => {
        const t = CHANGE_TEXTS[lang];
        if (change.kind === 'moved' && change.was && change.now) {
          const placeMoved = change.was.address !== change.now.address;
          return {
            title: t.movedTitle,
            body: t.moved
              .replace('{was}', where(change.was, lang, placeMoved))
              .replace('{now}', where(change.now, lang, placeMoved)),
          };
        }
        const here = where(
          { date, time: meeting.startTime, address: meeting.address },
          lang,
          change.kind === 'restored',
        );
        if (change.kind === 'cancelled') {
          return {
            title: t.cancelledTitle,
            body: meeting.cancelReason
              ? `${here}: ${meeting.cancelReason}`
              : here,
          };
        }
        return { title: t.restoredTitle, body: here };
      };
      const state =
        change.kind === 'moved' && change.now
          ? `${change.now.date}:${change.now.time}:${change.now.address}`
          : `${change.kind}:${(meeting.updatedAt ?? new Date()).toISOString()}`;
      const data = {
        type: 'field_service_meeting',
        meetingId: meeting.id,
        date,
      };
      if (change.toAssigned && assignedUsers.length) {
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: assignedUsers,
          text,
          kind: 'field_service_meeting',
          key: `field_service_change:${meeting.id}:${state}`,
          emailFallback: true,
          data,
        });
      }
      if (audienceUsers.length) {
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: audienceUsers,
          text,
          kind: 'field_service_change',
          key: `field_service_change:${meeting.id}:${state}`,
          data,
        });
      }
    } catch (e) {
      this.logger.warn(
        `change push failed (${change.kind}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Whom a meeting concerns: a group's own — that group; the congregation's
   * and «по группам» — everyone. The same rule the app draws the meeting by.
   */
  private async audienceUserIds(
    congregationId: string,
    meeting: FieldServiceMeeting,
  ): Promise<string[]> {
    const people = await this.publishersRepo.find({
      where: meeting.serviceGroupId
        ? { congregationId, serviceGroupId: meeting.serviceGroupId }
        : { congregationId },
      select: { id: true, userId: true },
    });
    return people.map((p) => p.userId).filter((id): id is string => !!id);
  }

  /**
   * «Сб 7 нояб., 10:30: зал на ремонте — собираемся у входа в парк», to
   * everyone the meeting concerns. The one message in this section that
   * goes beyond the men assigned — because the notice is ABOUT the reader's
   * own Saturday, not about the schedule in general. Keyed by meeting and
   * day, so an evening of rewording is one message per person.
   */
  private async notifyNotice(
    congregationId: string,
    meeting: FieldServiceMeeting,
  ): Promise<void> {
    try {
      const userIds = await this.audienceUserIds(congregationId, meeting);
      if (userIds.length === 0 || !meeting.notice) return;
      const date = meetingDateISO(meeting);
      const notice = meeting.notice;
      await this.notifications.notify({
        tenantId: congregationId,
        userIds,
        text: (lang) => ({
          title: NOTICE_TEXTS[lang].title,
          body: NOTICE_TEXTS[lang].body
            .replace('{day}', fmtDayShort(date, lang))
            .replace('{time}', meeting.startTime)
            .replace('{notice}', notice),
        }),
        kind: 'field_service_notice',
        key: `field_service_notice:${meeting.id}:${await this.clock.todayFor(congregationId)}`,
        data: {
          type: 'field_service_meeting',
          meetingId: meeting.id,
          date,
        },
      });
    } catch (e) {
      this.logger.warn(
        `notice push failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * `drafts` — include the meetings not yet announced. The controller passes
   * it only for a reader who may plan AND asked for them: an app that does
   * not know what a draft is never sees one, so a phone with last month's
   * version keeps showing exactly the announced schedule.
   */
  async list(
    congregationId: string,
    query: QueryFieldServiceMeetingsDto,
    drafts = false,
  ): Promise<FieldServiceMeeting[]> {
    const qb = this.repo
      .createQueryBuilder('m')
      .where('m.congregationId = :congregationId', { congregationId });
    if (!drafts) qb.andWhere('m.publishedAt IS NOT NULL');
    // A cancelled meeting only to an app that knows how to cross it out.
    if (query.cancelled !== '1') qb.andWhere('m.cancelledAt IS NULL');
    // With an upper bound this reads as a span; without one it stays the
    // exact week it has always been, so no existing caller changes behaviour.
    //
    // With NEITHER bound: the last year, not the whole history (October
    // 2026). The month page now asks for a window of its own; a phone still
    // on an older version, or any other client that asks for everything,
    // gets the year behind it and all that lies ahead — what the page could
    // show anyway — and the answer stops growing with every month in use.
    if (query.weekStart && query.weekEnd) {
      qb.andWhere('m.weekStartDate >= :weekStart', {
        weekStart: query.weekStart,
      }).andWhere('m.weekStartDate < :weekEnd', { weekEnd: query.weekEnd });
    } else if (query.weekStart) {
      qb.andWhere('m.weekStartDate = :weekStart', {
        weekStart: query.weekStart,
      });
    } else {
      qb.andWhere('m.weekStartDate >= :since', {
        since: addDaysISO(await this.clock.todayFor(congregationId), -365),
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
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
      );
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
      notice: cleanNotice(dto.notice),
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
        notice: saved.notice,
        isGeneral: saved.isGeneral,
        draft: saved.publishedAt === null,
      },
    });
    // A notice written on a meeting announced at once is news for everyone
    // it concerns; a draft's notice goes out with the month.
    if (saved.notice && saved.publishedAt !== null) {
      await this.notifyNotice(congregationId, saved);
    }
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
    // A cancelled meeting is brought back first, then changed: editing it in
    // its crossed-out state would move a meeting nobody is coming to.
    if (entity.cancelledAt) {
      throw new ConflictException(
        refusal(
          'FS_CANCELLED',
          'This field service meeting is cancelled; restore it before changing it.',
        ),
      );
    }
    let weekStartDate = entity.weekStartDate;
    if (dto.weekStartDate !== undefined) {
      const monday = new Date(`${dto.weekStartDate.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(monday.getTime()) || monday.getUTCDay() !== 1) {
        throw new BadRequestException(
          refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
        );
      }
      weekStartDate = dto.weekStartDate.slice(0, 10);
    }
    const dayOfWeek = dto.dayOfWeek ?? entity.dayOfWeek;
    const was: Where = {
      date: meetingDateISO(entity),
      time: entity.startTime,
      address: entity.address,
    };
    const newDate = addDaysISO(weekStartDate, dayOfWeek - 1);
    if (newDate !== was.date) {
      await this.assertNotHeld(congregationId, newDate, entity.id);
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
      weekStartDate: entity.weekStartDate,
      dayOfWeek: entity.dayOfWeek,
      startTime: entity.startTime,
      address: entity.address,
      conductorPublisherId: entity.conductorPublisherId,
      topic: entity.topic,
      notice: entity.notice,
      isGeneral: entity.isGeneral,
      serviceGroupId: entity.serviceGroupId,
      serviceOverseerVisit: entity.serviceOverseerVisit,
      serviceOverseerPublisherId: entity.serviceOverseerPublisherId,
      serviceOverseerAssistantId: entity.serviceOverseerAssistantId,
    };
    entity.weekStartDate = weekStartDate;
    if (dto.dayOfWeek !== undefined) entity.dayOfWeek = dto.dayOfWeek;
    if (dto.startTime !== undefined) entity.startTime = dto.startTime;
    if (dto.address !== undefined) entity.address = dto.address;
    if (dto.conductorPublisherId !== undefined) {
      entity.conductorPublisherId = dto.conductorPublisherId ?? null;
    }
    if (dto.topic !== undefined) entity.topic = dto.topic ?? null;
    if (dto.sourceUrl !== undefined) entity.sourceUrl = dto.sourceUrl ?? null;
    if (dto.notice !== undefined) entity.notice = cleanNotice(dto.notice);
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
        weekStartDate: saved.weekStartDate,
        dayOfWeek: saved.dayOfWeek,
        startTime: saved.startTime,
        address: saved.address,
        conductorPublisherId: saved.conductorPublisherId,
        topic: saved.topic,
        notice: saved.notice,
        isGeneral: saved.isGeneral,
        serviceGroupId: saved.serviceGroupId,
        serviceOverseerVisit: saved.serviceOverseerVisit,
        serviceOverseerPublisherId: saved.serviceOverseerPublisherId,
        serviceOverseerAssistantId: saved.serviceOverseerAssistantId,
      },
      fields: [
        'weekStartDate',
        'dayOfWeek',
        'startTime',
        'address',
        'conductorPublisherId',
        'topic',
        'notice',
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
    // A notice written or changed on an announced meeting goes to everyone
    // the meeting concerns. Cleared — nothing: «as usual» needs no message.
    // The draft is silent here as everywhere; its notice goes with the month.
    if (
      saved.publishedAt !== null &&
      saved.notice &&
      saved.notice !== before.notice
    ) {
      await this.notifyNotice(congregationId, saved);
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
    // The day, the hour or the place moved: news for everyone going.
    const now: Where = {
      date: meetingDateISO(saved),
      time: saved.startTime,
      address: saved.address,
    };
    if (
      saved.publishedAt !== null &&
      (now.date !== was.date ||
        now.time !== was.time ||
        now.address !== was.address)
    ) {
      // Told already, in their own words: a conductor or assistant just put
      // on («you conduct …») or just taken off («you no longer …»).
      const toldAlready = new Set<string>();
      if (prevConductorId !== saved.conductorPublisherId) {
        if (prevConductorId) toldAlready.add(prevConductorId);
        if (saved.conductorPublisherId) {
          toldAlready.add(saved.conductorPublisherId);
        }
      }
      if (prevAssistantId !== saved.serviceOverseerAssistantId) {
        if (prevAssistantId) toldAlready.add(prevAssistantId);
        if (saved.serviceOverseerAssistantId) {
          toldAlready.add(saved.serviceOverseerAssistantId);
        }
      }
      await this.notifyChange(congregationId, saved, {
        kind: 'moved',
        was,
        now,
        toAssigned: dto.notifyConductor !== false,
        toAudience: dto.notifyAudience !== false,
        skipPublishers: toldAlready,
      });
    }
    return saved;
  }

  /**
   * Call an announced meeting off. It stays in the schedule, crossed out with
   * its reason, so nobody is left to wonder whether they missed it; those
   * assigned to it are told, and — unless asked not to — everyone it
   * concerns. A draft was never announced: it is deleted, not cancelled.
   */
  async cancel(
    congregationId: string,
    id: string,
    dto: CancelFieldServiceMeetingDto,
  ): Promise<FieldServiceMeeting> {
    const entity = await this.repo.findOne({ where: { id, congregationId } });
    if (!entity) {
      throw new NotFoundException('Field service meeting not found');
    }
    await this.assertNotHeld(congregationId, meetingDateISO(entity), entity.id);
    if (entity.publishedAt === null) {
      throw new ConflictException(
        refusal(
          'FS_DRAFT_NOT_CANCELLABLE',
          'A draft was never announced; delete it instead of cancelling it.',
        ),
      );
    }
    if (entity.cancelledAt) {
      throw new ConflictException(
        refusal(
          'FS_ALREADY_CANCELLED',
          'This field service meeting is already cancelled.',
        ),
      );
    }
    entity.cancelledAt = new Date();
    entity.cancelReason = cleanNotice(dto.reason);
    const saved = await this.repo.save(entity);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'field_service_meeting',
      entityId: saved.id,
      subjectId: saved.conductorPublisherId,
      before: { cancelled: false, cancelReason: null },
      after: { cancelled: true, cancelReason: saved.cancelReason },
      fields: ['cancelled', 'cancelReason'],
    });
    await this.notifyChange(congregationId, saved, {
      kind: 'cancelled',
      toAssigned: true,
      toAudience: dto.notifyAudience !== false,
    });
    return saved;
  }

  /** Bring a cancelled meeting back — the same meeting, told the same way. */
  async restore(
    congregationId: string,
    id: string,
    dto: RestoreFieldServiceMeetingDto,
  ): Promise<FieldServiceMeeting> {
    const entity = await this.repo.findOne({ where: { id, congregationId } });
    if (!entity) {
      throw new NotFoundException('Field service meeting not found');
    }
    await this.assertNotHeld(congregationId, meetingDateISO(entity), entity.id);
    if (!entity.cancelledAt) {
      throw new ConflictException(
        refusal(
          'FS_NOT_CANCELLED',
          'This field service meeting is not cancelled.',
        ),
      );
    }
    const reason = entity.cancelReason;
    entity.cancelledAt = null;
    entity.cancelReason = null;
    const saved = await this.repo.save(entity);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'field_service_meeting',
      entityId: saved.id,
      subjectId: saved.conductorPublisherId,
      before: { cancelled: true, cancelReason: reason },
      after: { cancelled: false, cancelReason: null },
      fields: ['cancelled', 'cancelReason'],
    });
    await this.notifyChange(congregationId, saved, {
      kind: 'restored',
      toAssigned: true,
      toAudience: dto.notifyAudience !== false,
    });
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
    // A draft nobody was told about is not «cancelled» for anybody; a
    // meeting cancelled before it was deleted has been told already.
    if (entity.publishedAt === null || entity.cancelledAt) return;
    // Deleting an announced meeting calls it off for everyone who was going:
    // the conductor, on a visit the overseer and his assistant, and the group
    // or the congregation it was for. Until 13 October 2026 only the
    // conductor and the assistant heard; the overseer's own visit and the
    // whole group vanished from their screens without a word.
    await this.notifyChange(congregationId, entity, {
      kind: 'cancelled',
      toAssigned: true,
      toAudience: true,
    });
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
    // A notice written while the month was a draft was told to nobody; the
    // announcement is when it reaches the people it concerns.
    for (const m of drafts) {
      if (m.notice) await this.notifyNotice(congregationId, m);
    }

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
    // A cancelled meeting was nobody's turn.
    const meetings = await this.repo.find({
      where: { congregationId, cancelledAt: IsNull() },
    });
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
    // A topic of a cancelled meeting was never given.
    const meetings = await this.repo.find({
      where: { congregationId, cancelledAt: IsNull() },
    });
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
