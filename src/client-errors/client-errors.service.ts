import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ClientError } from '../entities/client-error.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportClientErrorDto } from './dto/report-client-error.dto';
import { fingerprintOf, routePattern, scrub } from './scrub';

/** How long a failure is kept. */
export const KEEP_DAYS = 30;

const NEW_KIND: Record<'ru' | 'en' | 'de', string> = {
  ru: 'Новый вид сбоя в приложении',
  en: 'A new kind of failure in the app',
  de: 'Eine neue Art von Fehler in der App',
};

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
      };
      const fingerprint = fingerprintOf(row);
      const seenBefore = await this.errors.exist({ where: { fingerprint } });
      // One row per failure per day: a repeat counts, it does not add a row.
      await this.errors.query(
        `INSERT INTO "client_errors"
           ("day", "fingerprint", "platform", "app_commit", "route", "role",
            "source", "message", "stack", "count", "first_at", "last_at")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10)
         ON CONFLICT ("day", "fingerprint") DO UPDATE SET
           "count" = "client_errors"."count" + 1,
           "last_at" = EXCLUDED."last_at",
           "app_commit" = EXCLUDED."app_commit"`,
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
        ],
      );
      if (!seenBefore) {
        await this.prune(now);
        await this.tellAdmins(row.route, row.message, row.day);
      }
    } catch (err) {
      this.logger.warn(`client error not recorded: ${(err as Error).message}`);
    }
  }

  /** The administrators of every congregation hear of a new kind, once a day. */
  private async tellAdmins(
    route: string,
    message: string,
    day: string,
  ): Promise<void> {
    if (!this.notifications) return;
    const admins = await this.users.find({
      where: { role: UserRole.ADMIN, isActive: true },
      select: { id: true, congregationId: true },
    });
    const byTenant = new Map<string, string[]>();
    for (const a of admins) {
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
        key: `client-error-new:${day}`,
        text: (lang) => ({
          title: NEW_KIND[lang] ?? NEW_KIND.ru,
          body: `${route}: ${message}`.slice(0, 180),
        }),
        data: { type: 'client_error' },
      });
    }
  }

  /** The last thirty days, the latest first. */
  async list(now = new Date()): Promise<ClientError[]> {
    await this.prune(now);
    return this.errors.find({ order: { lastAt: 'DESC' }, take: 500 });
  }
}
