import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  NestMiddleware,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { Observable, catchError, throwError } from 'rxjs';

/** One kind of failure on one route. */
export interface ServerErrorLine {
  /** «GET /api/announcements/:id» — the route's pattern, never a value. */
  route: string;
  /** The error's class — «TypeORMError», «QueryFailedError», «TypeError». */
  kind: string;
  count: number;
  lastAt: string;
}

const MAX_LINES = 100;
/** Days kept in the table (28 November 2026): a week of watching, and room. */
export const KEEP_DAYS = 30;
/** Distinct new lines a process writes per day — a flood stays bounded. */
const MAX_NEW_ROWS_PER_DAY = 200;

/**
 * Failures of this server since it started (27 November 2026).
 *
 * The 500s were seen only in the container's log, reached over ssh. Before
 * TypeORM's «a missing value in a where throws» goes live, whoever looks
 * after the server must see them from the browser: the routes, kinds and
 * counts, for the platform owner only — they span every congregation. Patterns and class names only — no
 * message, no parameter, nothing a person typed: what failed where, not with
 * what.
 */
@Injectable()
export class ServerErrors {
  private readonly logger = new Logger(ServerErrors.name);
  private total = 0;
  private readonly lines = new Map<string, ServerErrorLine>();
  private dropped = false;
  /** Keys written to the table today by this process, and that day. */
  private writtenDay = '';
  private readonly writtenKeys = new Set<string>();

  constructor(private readonly ds: DataSource) {}

  record(route: string, kind: string, at = new Date()): void {
    this.keep(route, kind, at);
    this.total += 1;
    const key = `${route}|${kind}`;
    const line = this.lines.get(key);
    if (line) {
      line.count += 1;
      line.lastAt = at.toISOString();
      return;
    }
    // A flood of distinct routes cannot grow without bound.
    if (this.lines.size >= MAX_LINES) {
      this.dropped = true;
      return;
    }
    this.lines.set(key, { route, kind, count: 1, lastAt: at.toISOString() });
  }

  /**
   * Also into the table (28 November 2026), so a restart or a deploy does
   * not wipe what was seen. Never awaited by the answer, never thrown: a
   * failed write — the database being the very thing down — leaves the
   * count in memory, as before.
   */
  private keep(route: string, kind: string, at: Date): void {
    const day = at.toISOString().slice(0, 10);
    if (day !== this.writtenDay) {
      this.writtenDay = day;
      this.writtenKeys.clear();
    }
    const key = `${route}|${kind}`;
    if (!this.writtenKeys.has(key)) {
      if (this.writtenKeys.size >= MAX_NEW_ROWS_PER_DAY) return;
      this.writtenKeys.add(key);
    }
    this.ds
      .query(
        `INSERT INTO server_errors_daily (day, route, kind, count, last_at)
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (day, route, kind)
         DO UPDATE SET count = server_errors_daily.count + 1, last_at = EXCLUDED.last_at`,
        [day, route.slice(0, 200), kind.slice(0, 80), at.toISOString()],
      )
      .catch(() => {
        // Counted in memory still; the table catches up with the next one.
      });
  }

  /**
   * What the table holds for the last `days` days — across restarts. Null
   * when it cannot be read: the caller answers from memory instead.
   */
  async kept(days: number): Promise<{
    since: string;
    total: number;
    lines: ServerErrorLine[];
  } | null> {
    try {
      const rows: {
        route: string;
        kind: string;
        count: string;
        last_at: Date;
      }[] = await this.ds.query(
        `SELECT route, kind, sum(count)::text AS count, max(last_at) AS last_at
             FROM server_errors_daily
            WHERE day > (now() AT TIME ZONE 'UTC')::date - $1::int
            GROUP BY route, kind
            ORDER BY max(last_at) DESC
            LIMIT ${MAX_LINES}`,
        [days],
      );
      const since = new Date(Date.now() - (days - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const lines = rows.map((r) => ({
        route: r.route,
        kind: r.kind,
        count: Number(r.count),
        lastAt: new Date(r.last_at).toISOString(),
      }));
      return {
        since,
        total: lines.reduce((s, l) => s + l.count, 0),
        lines,
      };
    } catch {
      return null;
    }
  }

  /** Older days go, each night. */
  @Cron('25 4 * * *')
  async prune(): Promise<void> {
    try {
      await this.ds.query(
        `DELETE FROM server_errors_daily WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::int`,
        [KEEP_DAYS],
      );
    } catch (err) {
      this.logger.warn(
        `server errors prune failed: ${(err as Error)?.constructor?.name}`,
      );
    }
  }

  count(): number {
    return this.total;
  }

  /** More distinct lines came than are kept: the list is not all of it. */
  truncated(): boolean {
    return this.dropped;
  }

  list(): ServerErrorLine[] {
    return [...this.lines.values()].sort((a, b) =>
      b.lastAt.localeCompare(a.lastAt),
    );
  }
}

/**
 * The error's class, left on the response for the middleware that counts —
 * only a handler's or an interceptor's error comes this way; one raised in a
 * guard or before is counted as «unknown» (independent check, 27 November
 * 2026: counting here alone missed every 5xx raised by a guard).
 */
@Injectable()
export class ServerErrorKindInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((e: unknown) => {
        if (ctx.getType() === 'http') {
          const res = ctx
            .switchToHttp()
            .getResponse<{ locals?: Record<string, unknown> }>();
          if (res.locals)
            res.locals.serverErrorKind =
              (e as { constructor?: { name?: string } })?.constructor?.name ||
              'Error';
        }
        return throwError(() => e);
      }),
    );
  }
}

/**
 * Counts every answer that FINISHED with a 5xx, wherever it was raised — a
 * guard, a pipe, a handler, a stream. The route's pattern only: an answer
 * that matched no route is «(no route)», never its raw path.
 */
@Injectable()
export class ServerErrorsMiddleware implements NestMiddleware {
  constructor(private readonly errors: ServerErrors) {}

  use(
    req: { method?: string; baseUrl?: string; route?: { path?: string } },
    res: {
      statusCode: number;
      locals?: Record<string, unknown>;
      on(event: 'finish', cb: () => void): unknown;
    },
    next: () => void,
  ): void {
    res.on('finish', () => {
      if (res.statusCode < 500) return;
      const pattern = req.route?.path
        ? `${req.baseUrl ?? ''}${req.route.path}`
        : '(no route)';
      const kind =
        typeof res.locals?.serverErrorKind === 'string'
          ? res.locals.serverErrorKind
          : 'unknown';
      this.errors.record(`${req.method ?? '?'} ${pattern}`, kind);
    });
    next();
  }
}
