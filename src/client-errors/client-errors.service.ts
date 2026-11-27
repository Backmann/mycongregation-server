import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ClientError } from '../entities/client-error.entity';
import { User } from '../entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportClientErrorDto } from './dto/report-client-error.dto';
import {
  fingerprintOf,
  isForeign,
  isNetwork,
  routePattern,
  scrub,
} from './scrub';

/** How long a failure is kept. */
export const KEEP_DAYS = 30;

/**
 * A failure of the network wakes nobody — unless it is met this many times
 * on one day: then it is no longer a weak signal on one phone.
 */
export const NETWORK_FLOOD = 20;

const NEW_KIND: Record<'ru' | 'en' | 'de', string> = {
  ru: 'Новый вид сбоя в приложении',
  en: 'A new kind of failure in the app',
  de: 'Eine neue Art von Fehler in der App',
};

const NETWORK_FLOOD_TITLE: Record<'ru' | 'en' | 'de', string> = {
  ru: 'Много сбоев сети в приложении',
  en: 'Many network failures in the app',
  de: 'Viele Netzwerkfehler in der App',
};

/** One row of the journal as an administrator reads it. */
export type ClientErrorView = ClientError & { network: boolean };

/**
 * The journal of failures met in the app (10 November 2026).
 *
 * A report is accepted from anyone — a failure can happen before signing in —
 * scrubbed here whatever the app did, and folded into one row per failure per
 * day. The first time a failure is met at all, the administrators hear of it,
 * at most once a day. Rows older than thirty days are deleted as new ones
 * come in and when the journal is read, so there is no clock to keep.
 */
@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger(ClientErrorsService.name);

  constructor(
    @InjectRepository(ClientError)
    private readonly errors: Repository<ClientError>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @Optional()
    private readonly notifications?: NotificationsService,
  ) {}

  private today(now = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  private async prune(now = new Date()): Promise<void> {
    const cut = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
    await this.errors.delete({ day: LessThan(this.today(cut)) });
  }

  /** Record one report; never throws — a failing journal must not fail the app. */
  async record(dto: ReportClientErrorDto, now = new Date()): Promise<void> {
    try {
      const row = {
        day: this.today(now),
        platform: dto.platform,
        source: dto.source,
        route: routePattern(dto.route),
        role: dto.role ?? null,
        message: scrub(dto.message, 300) || '—',
        stack: dto.stack ? scrub(dto.stack, 1500) : null,
        appCommit: dto.appCommit
          ? dto.appCommit.replace(/[^\w.-]/g, '').slice(0, 64)
          : null,
        event: dto.event ?? null,
        online: dto.online ?? null,
        place: dto.place ? scrub(dto.place, 300) : null,
        sinceStartS: dto.sinceStartS ?? null,
      };
      const network = isNetwork(row.message, row.online);
      const fingerprint = fingerprintOf(row);
      const seenBefore = await this.errors.exists({ where: { fingerprint } });
      // One row per failure per day: a repeat counts, it does not add a row.
      // The context as the last report gave it; an older build's report
      // (none) does not wipe what a newer one told.
      const [{ count }] = await this.errors.query<{ count: number }[]>(
        `INSERT INTO "client_errors"
           ("day", "fingerprint", "platform", "app_commit", "route", "role",
            "source", "message", "stack", "count", "first_at", "last_at",
            "event", "online", "place", "since_start_s")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10,
                 $11, $12, $13, $14)
         ON CONFLICT ("day", "fingerprint") DO UPDATE SET
           "count" = "client_errors"."count" + 1,
           "last_at" = EXCLUDED."last_at",
           "app_commit" = EXCLUDED."app_commit",
           "event" = coalesce(EXCLUDED."event", "client_errors"."event"),
           "online" = coalesce(EXCLUDED."online", "client_errors"."online"),
           "place" = coalesce(EXCLUDED."place", "client_errors"."place"),
           "since_start_s" = coalesce(EXCLUDED."since_start_s", "client_errors"."since_start_s")
         RETURNING "count"`,
        [
          row.day,
          fingerprint,
          row.platform,
          row.appCommit,
          row.route,
          row.role,
          row.source,
          row.message,
          row.stack,
          now,
          row.event,
          row.online,
          row.place,
          row.sinceStartS,
        ],
      );
      if (!seenBefore) {
        await this.prune(now);
        // Code the app never runs (a console, an extension), or a request
        // that did not get through: kept, not told.
        if (!isForeign(row.stack) && !network)
          await this.tellAdmins(row.route, row.message, row.day);
      }
      // The network's failure met again and again on one day: told once.
      if (network && Number(count) === NETWORK_FLOOD)
        await this.tellAdmins(row.route, row.message, row.day, true);
    } catch (err) {
      this.logger.warn(`client error not recorded: ${(err as Error).message}`);
    }
  }

  /**
   * Whoever runs the platform hears of a new kind, once a day (15 November
   * 2026: no longer every congregation's administrator). Nobody marked: the
   * failure is still kept, and the server's log says that nobody was told.
   */
  private async tellAdmins(
    route: string,
    message: string,
    day: string,
    flood = false,
  ): Promise<void> {
    if (!this.notifications) return;
    const owners = await this.users.find({
      where: { isOwner: true, isActive: true },
      select: { id: true, congregationId: true },
    });
    if (owners.length === 0) {
      this.logger.warn('a new kind of failure, and nobody to tell it to');
      return;
    }
    const byTenant = new Map<string, string[]>();
    for (const a of owners) {
      byTenant.set(a.congregationId, [
        ...(byTenant.get(a.congregationId) ?? []),
        a.id,
      ]);
    }
    for (const [tenantId, userIds] of byTenant) {
      await this.notifications.notify({
        tenantId,
        userIds,
        kind: 'client_error',
        key: flood ? `client-error-network:${day}` : `client-error-new:${day}`,
        text: (lang) => ({
          title: flood
            ? (NETWORK_FLOOD_TITLE[lang] ?? NETWORK_FLOOD_TITLE.ru)
            : (NEW_KIND[lang] ?? NEW_KIND.ru),
          body: `${route}: ${message}`.slice(0, 180),
        }),
        data: { type: 'client_error' },
      });
    }
  }

  /** The last thirty days, the latest first. */
  async list(now = new Date()): Promise<ClientErrorView[]> {
    await this.prune(now);
    const rows = await this.errors.find({
      order: { lastAt: 'DESC' },
      take: 500,
    });
    return rows.map((r) => ({
      ...r,
      network: isNetwork(r.message, r.online),
    }));
  }
}
