import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { CalendarFeed } from '../entities/calendar-feed.entity';
import { Congregation } from '../entities/congregation.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { AgendaService } from '../agenda/agenda.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { addDaysISO } from '../common/week-rules';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
} from '../common/i18n/supported-languages';
import { buildIcs, FeedOptions, feedTag } from './ics';

/** How far the calendar reaches: a year back, a year ahead (7 November 2026). */
export const FEED_DAYS_BACK = 365;
export const FEED_DAYS_AHEAD = 365;
/** «Last fetched» is written at most this often — a calendar may ask every few minutes. */
const FETCH_MARK_EVERY_MS = 10 * 60 * 1000;

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
  status: 200 | 304;
  etag: string;
  body: string | null;
}

@Injectable()
export class CalendarFeedService {
  private readonly logger = new Logger(CalendarFeedService.name);

  constructor(
    @InjectRepository(CalendarFeed)
    private readonly feeds: Repository<CalendarFeed>,
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
    await this.feeds.delete({ userId });
    return this.view(null);
  }

  /**
   * Switched off for the person — when they sign out everywhere or get a new
   * password: whoever might have had the phone keeps no way into the agenda.
   */
  async revokeFor(userId: string, reason: string): Promise<void> {
    await this.feeds.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  private async fresh(
    congregationId: string,
    userId: string,
    existing: CalendarFeed | null,
  ): Promise<CalendarFeed> {
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
   * The feed for a token, as a calendar asks for it. Null for any token that
   * is not a live link — the caller answers 404 the same way for all of them.
   */
  async read(
    token: string,
    ifNoneMatch: string | undefined,
    userAgent: string | undefined,
  ): Promise<FeedResponse | null> {
    if (!TOKEN_RE.test(token)) return null;
    const feed = await this.feeds.findOne({
      where: { tokenHash: hashToken(token), revokedAt: IsNull() },
    });
    if (!feed) return null;
    const user = await this.users.findOne({ where: { id: feed.userId } });
    if (
      !user ||
      !user.isActive ||
      user.congregationId !== feed.congregationId
    ) {
      return null;
    }
    const me = await this.publishers.findOne({
      where: { congregationId: feed.congregationId, userId: feed.userId },
    });
    const lang = isSupportedLanguage(user.uiLanguage)
      ? user.uiLanguage
      : DEFAULT_LANGUAGE;
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
    const etag = feedTag(items, opts, lang);
    if (ifNoneMatch && ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
      return { status: 304, etag, body: null };
    }
    const congregation = await this.congregations.findOne({
      where: { id: feed.congregationId },
    });
    const body = buildIcs(items, opts, {
      lang,
      timezone: await this.clock.timezoneOf(feed.congregationId),
      congregation: congregation?.name ?? '',
      appUrl: this.appUrl(),
      now: new Date(),
    });
    return { status: 200, etag, body };
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
