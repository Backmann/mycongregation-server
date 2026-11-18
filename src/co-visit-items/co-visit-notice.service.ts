import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { CoVisitTold } from '../entities/co-visit-told.entity';
import { Publisher } from '../entities/publisher.entity';
import { PushToken } from '../entities/push-token.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { User } from '../entities/user.entity';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { refusal } from '../common/errors/refusal';
import {
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '../common/i18n/supported-languages';
import {
  type CoNoticeLine,
  type CoVisitor,
  diffLines,
  fingerprint,
  isEmptyDiff,
  linesByPerson,
  messageOf,
} from './co-visit-notice';

/** How long after the last edit of a published visit its people are told. */
export const CO_SETTLE_MS = 10 * 60 * 1000;

const VISIT = 'circuit_overseer_visit';

const langOf = (l: string | null | undefined): SupportedLanguage =>
  (SUPPORTED_LANGUAGES as readonly string[]).includes(l ?? '')
    ? (l as SupportedLanguage)
    : 'ru';

/** How a person would hear of it. */
export type CoReach = 'device' | 'email' | 'none' | 'no_login';

export interface CoPublicationRow {
  publisherId: string;
  name: string;
  reach: CoReach;
  /** The message he would get now, in the reader's language; null: nothing new. */
  title: string | null;
  body: string | null;
}

export interface CoPublication {
  publishedAt: string | null;
  noticedAt: string | null;
  /** An edit not yet told: when it goes. */
  dueAt: string | null;
  /** Who would hear what if it went now. */
  rows: CoPublicationRow[];
  /** Lines with a name typed as text: nobody the app can reach. */
  textOnly: { date: string; time: string | null; kind: string; text: string }[];
}

/**
 * The visit schedule speaks for itself once published (18 November 2026).
 *
 * See co-visit-notice.ts for what is said; this fetches, sends through the
 * one gateway (quiet hours, «said once», letters for those with no device)
 * and remembers what each person was told.
 */
@Injectable()
export class CoVisitNoticeService {
  private readonly logger = new Logger(CoVisitNoticeService.name);

  constructor(
    @InjectRepository(CoVisitItem)
    private readonly items: Repository<CoVisitItem>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(CoVisitTold)
    private readonly told: Repository<CoVisitTold>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PushToken)
    private readonly tokens: Repository<PushToken>,
    @InjectRepository(WebPushSubscription)
    private readonly subscriptions: Repository<WebPushSubscription>,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
  ) {}

  private visitorOf(e: SpecialEvent): CoVisitor {
    return {
      name: [e.coFirstName, e.coLastName].filter(Boolean).join(' ').trim(),
      wife: e.coWifeName?.trim() ?? '',
    };
  }

  private async visit(congregationId: string, id: string) {
    const e = await this.events.findOne({
      where: { id, congregationId, type: VISIT },
    });
    if (!e) throw new NotFoundException('Visit not found');
    return e;
  }

  /** Each person's lines now, and what each was told. */
  private async state(congregationId: string, eventId: string) {
    const rows = await this.items.find({
      where: { congregationId, specialEventId: eventId },
      relations: { cartLocation: true },
    });
    const now = linesByPerson(
      rows.map((r) => ({
        ...r,
        cartLocationName: r.cartLocation?.name ?? null,
      })),
    );
    const toldRows = await this.told.find({
      where: { congregationId, specialEventId: eventId },
    });
    const told = new Map(toldRows.map((t) => [t.publisherId, t.lines]));
    const toldAt = new Map(
      toldRows.map((t) => [t.publisherId, t.toldAt.getTime()]),
    );
    const people = [...new Set([...now.keys(), ...told.keys()])];
    return { rows, now, told, toldAt, people };
  }

  /**
   * Say to everybody what changed for him since he was last told, and write
   * down what he now holds. A person no account can reach is written down
   * too: the planner was shown that he must be told by voice.
   */
  async announce(congregationId: string, event: SpecialEvent): Promise<number> {
    const { now, told, toldAt, people } = await this.state(
      congregationId,
      event.id,
    );
    if (people.length === 0) return 0;
    const cards = await this.publishers.find({
      where: { congregationId, id: In(people) },
    });
    const userOf = new Map(cards.map((c) => [c.id, c.userId]));
    const v = this.visitorOf(event);
    let said = 0;
    for (const pid of people) {
      const was = told.get(pid) ?? [];
      const is = now.get(pid) ?? [];
      const diff = diffLines(was, is);
      if (isEmptyDiff(diff)) continue;
      const userId = userOf.get(pid);
      if (userId) {
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: [userId],
          text: (lang) => messageOf(diff, v, lang)!,
          kind: 'co_visit',
          // The same change is said once — a publish and a pass racing read
          // the same «told» moment. Never the same key twice for real news:
          // the moment moves with every word, so an undone deletion or a
          // time toggled back is said again (review, 18 November 2026).
          key: `co-visit:${event.id}:${pid}:${toldAt.get(pid) ?? 0}>${fingerprint(is)}`,
          data: { type: 'co_visit', eventId: event.id },
          // His own assignment: by letter when no device reaches him.
          emailFallback: true,
        });
        said += 1;
      }
      // Kept even when empty: its moment is what the next key counts from.
      await this.told.upsert(
        {
          congregationId,
          specialEventId: event.id,
          publisherId: pid,
          lines: is,
          toldAt: new Date(),
        },
        { conflictPaths: ['specialEventId', 'publisherId'] },
      );
    }
    return said;
  }

  /** The last edit of a visit's items — deleted ones included. */
  private async lastEditOf(
    congregationId: string,
    eventId: string,
  ): Promise<Date | null> {
    const r: { last: Date | null }[] = await this.items.manager.query(
      `SELECT max(greatest(updated_at, created_at, coalesce(deleted_at, created_at))) AS last
         FROM co_visit_items WHERE congregation_id = $1 AND special_event_id = $2`,
      [congregationId, eventId],
    );
    return r[0]?.last ? new Date(r[0].last) : null;
  }

  /** What the planner sees above the week, and in the window before publishing. */
  async publication(
    congregationId: string,
    eventId: string,
    readerLang: string,
  ): Promise<CoPublication> {
    const event = await this.visit(congregationId, eventId);
    const lang = langOf(readerLang);
    const {
      rows: items,
      now,
      told,
      people,
    } = await this.state(congregationId, eventId);
    const cards = people.length
      ? await this.publishers.find({
          where: { congregationId, id: In(people) },
        })
      : [];
    const userIds = cards.map((c) => c.userId).filter((x): x is string => !!x);
    const [users, tokens, subs] = userIds.length
      ? await Promise.all([
          this.users.find({ where: { id: In(userIds) } }),
          this.tokens.find({
            where: { userId: In(userIds) },
            select: { userId: true },
          }),
          this.subscriptions.find({
            where: { userId: In(userIds) },
            select: { userId: true },
          }),
        ])
      : [[], [], []];
    const withDevice = new Set([
      ...tokens.map((t) => t.userId),
      ...subs.map((s) => s.userId),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const v = this.visitorOf(event);
    const rows: CoPublicationRow[] = cards
      .map((c) => {
        const u = c.userId ? userById.get(c.userId) : undefined;
        const reach: CoReach =
          !u || !u.isActive
            ? 'no_login'
            : withDevice.has(u.id)
              ? 'device'
              : u.email
                ? 'email'
                : 'none';
        const msg = messageOf(
          diffLines(told.get(c.id) ?? [], now.get(c.id) ?? []),
          v,
          lang,
        );
        return {
          publisherId: c.id,
          name: `${c.lastName} ${c.firstName}`.trim(),
          reach,
          title: msg?.title ?? null,
          body: msg?.body ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const textOnly = items
      .filter(
        (i) =>
          !i.assigneePublisherId &&
          !!i.assigneeText?.trim() &&
          i.kind !== 'document_review' &&
          !(i.forWife && i.kind !== 'field_service'),
      )
      .map((i) => ({
        date: i.itemDate,
        time: i.startTime ? i.startTime.slice(0, 5) : null,
        kind: i.kind,
        text: i.assigneeText!.trim(),
      }))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    let dueAt: string | null = null;
    if (event.coPublishedAt) {
      const last = await this.lastEditOf(congregationId, eventId);
      const since = event.coNoticedAt ?? event.coPublishedAt;
      if (last && last > since && rows.some((r) => r.title))
        dueAt = new Date(last.getTime() + CO_SETTLE_MS).toISOString();
    }
    return {
      publishedAt: event.coPublishedAt?.toISOString() ?? null,
      noticedAt: event.coNoticedAt?.toISOString() ?? null,
      dueAt,
      rows,
      textOnly,
    };
  }

  /**
   * Publish the week: from now on it is seen and it speaks. Refused for a
   * visit that is over; a second press says only what changed since.
   */
  async publish(congregationId: string, eventId: string, userId: string) {
    const event = await this.visit(congregationId, eventId);
    const today = await this.clock.todayFor(congregationId);
    if ((event.endDate ?? event.date) < today)
      throw new ConflictException(
        refusal(
          'CO_VISIT_PAST_LOCKED',
          'This visit is already over; its programme is part of the record and can no longer be changed.',
          { date: event.endDate ?? event.date },
        ),
      );
    const first = !event.coPublishedAt;
    if (first) event.coPublishedAt = new Date();
    // Told up to the last edit READ, never to «now»: an edit saved while the
    // messages go out is the next pass's (review, 18 November 2026).
    const last = await this.lastEditOf(congregationId, eventId);
    const said = await this.announce(congregationId, event);
    event.coNoticedAt =
      last && last > event.coPublishedAt! ? last : event.coPublishedAt;
    await this.events.update(event.id, {
      coPublishedAt: event.coPublishedAt,
      coNoticedAt: event.coNoticedAt,
    });
    if (first)
      await this.auditLog.logFact({
        tenantId: congregationId,
        entityType: 'co_visit_item',
        entityId: eventId,
        action: 'UPDATE',
        actorUserId: userId,
        detail: {
          visitPublished: event.coPublishedAt!.toISOString(),
          toldPeople: said,
        },
      });
    return { publishedAt: event.coPublishedAt!.toISOString(), told: said };
  }

  /**
   * Every minute: a published, coming visit edited at least ten minutes ago
   * and not told since — its people are told. The gateway holds what falls
   * at night until the morning.
   */
  async tick(now = new Date()): Promise<number> {
    const visits = await this.events.find({
      where: { type: VISIT, coPublishedAt: Not(IsNull()) },
    });
    let done = 0;
    for (const e of visits) {
      try {
        const today = await this.clock.todayFor(e.congregationId);
        if ((e.endDate ?? e.date) < today) continue;
        const last = await this.lastEditOf(e.congregationId, e.id);
        const since = e.coNoticedAt ?? e.coPublishedAt!;
        if (!last || last <= since) continue;
        if (last.getTime() + CO_SETTLE_MS > now.getTime()) continue;
        await this.announce(e.congregationId, e);
        // Told up to the edit that was read: one made while telling is the
        // next pass's.
        await this.events.update(e.id, { coNoticedAt: last });
        done += 1;
      } catch (err) {
        this.logger.error(`visit ${e.id}: ${String(err)}`);
      }
    }
    return done;
  }

  /** Lines told — for a test or a check, never shown as they are. */
  async toldLines(
    eventId: string,
    publisherId: string,
  ): Promise<CoNoticeLine[]> {
    return (
      (
        await this.told.findOne({
          where: { specialEventId: eventId, publisherId },
        })
      )?.lines ?? []
    );
  }
}
