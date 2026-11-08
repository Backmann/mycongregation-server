import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { CalendarFeed } from '../entities/calendar-feed.entity';
import { CalendarFeedRetired } from '../entities/calendar-feed-retired.entity';
import { Congregation } from '../entities/congregation.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { AgendaService } from '../agenda/agenda.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { addDaysISO } from '../common/week-rules';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { buildIcs, FeedOptions, noticeIcs } from './ics';

/** How far the calendar reaches: a year back, a year ahead (7 November 2026). */
export const FEED_DAYS_BACK = 365;
export const FEED_DAYS_AHEAD = 365;
/** «Last fetched» is written at most this often — a calendar may ask every few minutes. */
const FETCH_MARK_EVERY_MS = 10 * 60 * 1000;
/** How long a link that no longer works still answers with the notice. */
const RETIRED_KEEP_DAYS = 183;

/** The token is 32 random bytes in base64url: 43 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * «https://host/api» from the request that reached us — the host checked to
 * be a plain host name, the scheme taken from the proxy in front.
 */
export function requestBase(headers: {
  host?: string;
  'x-forwarded-proto'?: string | string[];
}): string | null {
  const host = headers.host?.trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const raw = headers['x-forwarded-proto'];
  const proto = (Array.isArray(raw) ? raw[0] : (raw ?? ''))
    .split(',')[0]
    .trim();
  const scheme =
    proto === 'https' || proto === 'http'
      ? proto
      : /^(localhost|127\.0\.0\.1)(:|$)/.test(host)
        ? 'http'
        : 'https';
  return `${scheme}://${host}/api`;
}

/** Which calendar is asking, from its User-Agent — only to tell the person «Google», «Apple»… */
export function clientOf(userAgent: string | undefined): string {
  const ua = (userAgent ?? '').toLowerCase();
  if (ua.includes('google')) return 'google';
  if (
    ua.includes('dataaccessd') ||
    ua.includes('ios/') ||
    ua.includes('macos/') ||
    ua.includes('calendaragent') ||
    ua.includes('apple')
  ) {
    return 'apple';
  }
  if (ua.includes('microsoft') || ua.includes('outlook')) return 'outlook';
  return 'other';
}

export interface FeedView {
  connected: boolean;
  /** The link to give a calendar; only while connected. */
  url: string | null;
  /** The same link as webcal://, for one-tap subscribing. */
  webcalUrl: string | null;
  options: FeedOptions;
  createdAt: string | null;
  lastFetchedAt: string | null;
  lastClient: string | null;
  /** Why it stopped, when it was switched off for the person. */
  revokedReason: string | null;
}

export interface FeedResponse {
  /** The person's calendar, or the notice of a link that no longer works. */
  kind: 'feed' | 'notice';
  body: string;
}

@Injectable()
export class CalendarFeedService {
  private readonly logger = new Logger(CalendarFeedService.name);

  constructor(
    @InjectRepository(CalendarFeed)
    private readonly feeds: Repository<CalendarFeed>,
    @InjectRepository(CalendarFeedRetired)
    private readonly retired: Repository<CalendarFeedRetired>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly agenda: AgendaService,
    private readonly clock: CongregationClock,
    private readonly config: ConfigService,
  ) {}

  /**
   * Where the server answers, for the link. The app talks to a host of its
   * own (api.mycongregation.org), and «mycongregation.org/api» there is the
   * WEBSITE, not this server — so the link takes the address the app itself
   * reached us at, unless PUBLIC_API_URL says otherwise (8 November 2026).
   */
  private apiBase(requestBase?: string | null): string {
    const api = this.config.get<string>('PUBLIC_API_URL');
    if (api) return api.replace(/\/+$/, '');
    if (requestBase) return requestBase;
    const app = (
      this.config.get<string>('PUBLIC_APP_URL') ?? 'https://mycongregation.org'
    ).replace(/\/+$/, '');
    return `${app}/api`;
  }

  private appUrl(): string {
    return (
      this.config.get<string>('PUBLIC_APP_URL') ?? 'https://mycongregation.org'
    ).replace(/\/+$/, '');
  }

  private view(feed: CalendarFeed | null, base?: string | null): FeedView {
    const live = !!feed && !feed.revokedAt;
    const url = live
      ? `${this.apiBase(base)}/calendar/${feed.token}.ics`
      : null;
    return {
      connected: live,
      url,
      webcalUrl: url ? url.replace(/^https?:\/\//, 'webcal://') : null,
      options: {
        mine: feed?.includeMine ?? true,
        events: feed?.includeEvents ?? true,
        names: feed?.includeNames ?? true,
      },
      createdAt: live ? feed.createdAt.toISOString() : null,
      lastFetchedAt: live ? (feed.lastFetchedAt?.toISOString() ?? null) : null,
      lastClient: live ? feed.lastClient : null,
      revokedReason: feed?.revokedAt ? feed.revokedReason : null,
    };
  }

  async get(userId: string, base?: string | null): Promise<FeedView> {
    return this.view(await this.feeds.findOne({ where: { userId } }), base);
  }

  /** Connects, or returns the link already there — pressing twice must not break the first phone. */
  async connect(
    congregationId: string,
    userId: string,
    base?: string | null,
  ): Promise<FeedView> {
    const existing = await this.feeds.findOne({ where: { userId } });
    if (existing && !existing.revokedAt) return this.view(existing, base);
    return this.view(await this.fresh(congregationId, userId, existing), base);
  }

  /** A new link; the old one stops working at once. */
  async rotate(
    congregationId: string,
    userId: string,
    base?: string | null,
  ): Promise<FeedView> {
    const existing = await this.feeds.findOne({ where: { userId } });
    return this.view(await this.fresh(congregationId, userId, existing), base);
  }

  async setOptions(
    userId: string,
    patch: Partial<FeedOptions>,
    base?: string | null,
  ): Promise<FeedView> {
    const feed = await this.feeds.findOne({
      where: { userId, revokedAt: IsNull() },
    });
    if (!feed) throw new NotFoundException('Calendar is not connected');
    if (patch.mine !== undefined) feed.includeMine = patch.mine;
    if (patch.events !== undefined) feed.includeEvents = patch.events;
    if (patch.names !== undefined) feed.includeNames = patch.names;
    return this.view(await this.feeds.save(feed), base);
  }

  /** Off: the link stops; the calendar drops the events at its next read. */
  async disconnect(userId: string): Promise<FeedView> {
    const feed = await this.feeds.findOne({ where: { userId } });
    if (feed) {
      await this.retire(
        feed,
        feed.revokedAt ? feed.revokedReason : 'disconnected',
      );
      await this.feeds.delete({ id: feed.id });
    }
    return this.view(null);
  }

  /** Keeps the hash of a link that stops working, so it can still say so. */
  private async retire(feed: CalendarFeed, reason: string | null) {
    const user = await this.users.findOne({
      where: { id: feed.userId },
      select: { id: true, uiLanguage: true },
    });
    await this.retired.upsert(
      {
        tokenHash: feed.tokenHash,
        congregationId: feed.congregationId,
        lang:
          user && isSupportedLanguage(user.uiLanguage)
            ? user.uiLanguage
            : DEFAULT_LANGUAGE,
        reason: reason ?? 'rotated',
      },
      ['tokenHash'],
    );
    await this.retired.delete({
      retiredAt: LessThan(
        new Date(Date.now() - RETIRED_KEEP_DAYS * 86_400_000),
      ),
    });
  }

  private async fresh(
    congregationId: string,
    userId: string,
    existing: CalendarFeed | null,
  ): Promise<CalendarFeed> {
    if (existing) {
      await this.retire(
        existing,
        existing.revokedAt ? existing.revokedReason : 'rotated',
      );
    }
    const token = randomBytes(32).toString('base64url');
    const feed =
      existing ??
      this.feeds.create({
        congregationId,
        userId,
        includeMine: true,
        includeEvents: true,
        includeNames: true,
      });
    feed.token = token;
    feed.tokenHash = hashToken(token);
    feed.revokedAt = null;
    feed.revokedReason = null;
    feed.lastFetchedAt = null;
    feed.lastClient = null;
    if (existing) feed.createdAt = new Date();
    return this.feeds.save(feed);
  }

  /**
   * The feed for a token, as a calendar asks for it.
   *
   * - a live link: the person's calendar;
   * - a link that WAS real (changed, switched off, ended with the sessions,
   *   its login switched off): an empty calendar with one notice, so the
   *   phone drops the old events instead of keeping them for good;
   * - anything else: null, and the caller answers a plain 404.
   */
  async read(
    token: string,
    userAgent: string | undefined,
  ): Promise<FeedResponse | null> {
    if (!TOKEN_RE.test(token)) return null;
    const hash = hashToken(token);
    const feed = await this.feeds.findOne({ where: { tokenHash: hash } });
    if (!feed) {
      const old = await this.retired.findOne({ where: { tokenHash: hash } });
      if (!old) return null;
      return this.notice(
        old.congregationId,
        isSupportedLanguage(old.lang) ? old.lang : DEFAULT_LANGUAGE,
      );
    }
    const user = await this.users.findOne({ where: { id: feed.userId } });
    const lang =
      user && isSupportedLanguage(user.uiLanguage)
        ? user.uiLanguage
        : DEFAULT_LANGUAGE;
    if (
      feed.revokedAt ||
      !user ||
      !user.isActive ||
      user.congregationId !== feed.congregationId
    ) {
      return this.notice(feed.congregationId, lang);
    }
    const me = await this.publishers.findOne({
      where: { congregationId: feed.congregationId, userId: feed.userId },
    });
    const opts: FeedOptions = {
      mine: feed.includeMine,
      events: feed.includeEvents,
      names: feed.includeNames,
    };
    const today = await this.clock.todayFor(feed.congregationId);
    const items = me
      ? (
          await this.agenda.forPublisher(feed.congregationId, me, {
            from: addDaysISO(today, -FEED_DAYS_BACK),
            to: addDaysISO(today, FEED_DAYS_AHEAD),
            lang,
            withNames: opts.names,
          })
        ).items
      : [];
    await this.markFetched(feed, userAgent);
    // Always the whole text, made now: «актуально на» then means what it
    // says. The agenda is built either way; a 304 would only have saved the
    // few dozen kilobytes of text (8 November 2026).
    return {
      kind: 'feed',
      body: buildIcs(items, opts, {
        lang,
        timezone: await this.clock.timezoneOf(feed.congregationId),
        congregation: await this.congregationName(feed.congregationId),
        appUrl: this.appUrl(),
        now: new Date(),
      }),
    };
  }

  private async congregationName(id: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id },
      select: { id: true, name: true },
    });
    return c?.name ?? '';
  }

  private async notice(
    congregationId: string,
    lang: SupportedLanguage,
  ): Promise<FeedResponse> {
    return {
      kind: 'notice',
      body: noticeIcs({
        lang,
        timezone: await this.clock.timezoneOf(congregationId),
        congregation: await this.congregationName(congregationId),
        appUrl: this.appUrl(),
        now: new Date(),
        today: await this.clock.todayFor(congregationId),
      }),
    };
  }

  private async markFetched(feed: CalendarFeed, userAgent?: string) {
    const now = Date.now();
    if (
      feed.lastFetchedAt &&
      now - feed.lastFetchedAt.getTime() < FETCH_MARK_EVERY_MS
    ) {
      return;
    }
    try {
      await this.feeds.update(
        { id: feed.id },
        { lastFetchedAt: new Date(now), lastClient: clientOf(userAgent) },
      );
    } catch (err) {
      // A calendar must get its events even when the mark cannot be written.
      this.logger.warn(`could not mark a calendar fetch: ${String(err)}`);
    }
  }
}
