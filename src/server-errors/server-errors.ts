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
  /** Keys this process has written today, and that UTC day. */
  private writtenDay = '';
  private readonly writtenKeys = new Set<string>();
  /** A new key was skipped today: more distinct lines than are kept. */
  private capHit = false;
  /**
   * Counts not in the table yet, by day, route and class — added up here and
   * written together, one write at a time (independent review, 28 November
   * 2026: a write per failure would queue without bound on the very
   * connections a slow database is short of). Kept on a failed write.
   */
  private readonly pending = new Map<
    string,
    { day: string; route: string; kind: string; count: number; lastAt: string }
  >();
  private writing: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

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
   * Also into the table, so a restart or a deploy does not wipe what was
   * seen. Never awaited by the answer, never thrown. Days are UTC on
   * purpose: the platform's own count, not a congregation's today.
   */
  private keep(route: string, kind: string, at: Date): void {
    const day = at.toISOString().slice(0, 10);
    if (day !== this.writtenDay) {
      this.writtenDay = day;
      this.writtenKeys.clear();
      this.capHit = false;
    }
    const r = route.slice(0, 200);
    const k = kind.slice(0, 80);
    const key = `${day}|${r}|${k}`;
    if (!this.writtenKeys.has(key)) {
      if (this.writtenKeys.size >= MAX_NEW_ROWS_PER_DAY) {
        this.capHit = true;
        return;
      }
      this.writtenKeys.add(key);
    }
    const p = this.pending.get(key);
    if (p) {
      p.count += 1;
      if (at.toISOString() > p.lastAt) p.lastAt = at.toISOString();
    } else {
      this.pending.set(key, {
        day,
        route: r,
        kind: k,
        count: 1,
        lastAt: at.toISOString(),
      });
    }
    void this.write();
  }

  /**
   * Everything pending in one statement; one at a time; kept on failure.
   * After a failure the next try waits for its timer, however many failures
   * come meanwhile (they add up in pending). Counts are lost only if the
   * process ends while writes are failing: this app has no shutdown hooks,
   * so there is no last try. A write that commits and then loses its reply
   * is written twice — a diagnostic count; accepted.
   */
  private write(force = false): Promise<void> {
    if (this.writing) return this.writing;
    if (this.retry && !force) return Promise.resolve();
    if (this.pending.size === 0) return Promise.resolve();
    // A day the table already deletes is not written at all.
    const oldest = new Date(Date.now() - KEEP_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const batch = [...this.pending.values()].filter((b) => b.day >= oldest);
    this.pending.clear();
    if (batch.length === 0) return Promise.resolve();
    this.writing = this.ds
      .query(
        `INSERT INTO server_errors_daily AS t (day, route, kind, count, last_at)
         SELECT * FROM unnest($1::date[], $2::varchar[], $3::varchar[], $4::int[], $5::timestamptz[])
         ON CONFLICT (day, route, kind)
         DO UPDATE SET count = t.count + EXCLUDED.count,
                       last_at = GREATEST(t.last_at, EXCLUDED.last_at)`,
        [
          batch.map((b) => b.day),
          batch.map((b) => b.route),
          batch.map((b) => b.kind),
          batch.map((b) => b.count),
          batch.map((b) => b.lastAt),
        ],
      )
      .then(
        () => undefined,
        () => {
          // Back into pending, added to whatever came meanwhile; tried again.
          for (const b of batch) {
            const key = `${b.day}|${b.route}|${b.kind}`;
            const p = this.pending.get(key);
            if (p) {
              p.count += b.count;
              if (b.lastAt > p.lastAt) p.lastAt = b.lastAt;
            } else this.pending.set(key, { ...b });
          }
          if (!this.retry)
            this.retry = setTimeout(() => {
              this.retry = null;
              void this.write(true);
            }, 30_000);
          // A retry never keeps the process (or a test run) alive.
          this.retry?.unref?.();
        },
      )
      .finally(() => {
        this.writing = null;
        // What came while this one was on its way.
        if (this.pending.size && !this.retry) void this.write();
      });
    return this.writing;
  }

  /** Not written yet — shown with what the table holds. */
  private pendingLines(): {
    day: string;
    route: string;
    kind: string;
    count: number;
    lastAt: string;
  }[] {
    return [...this.pending.values()];
  }

  /**
   * What the table holds for the last `days` days — across restarts — with
   * this process's not-yet-written counts added. Null when the table cannot
   * be read: the caller answers from memory instead.
   */
  async kept(days: number): Promise<{
    since: string;
    total: number;
    truncated: boolean;
    lines: ServerErrorLine[];
  } | null> {
    try {
      const rows: {
        route: string;
        kind: string;
        count: string;
        last_at: Date;
        groups: string;
        all_count: string;
      }[] = await this.ds.query(
        `SELECT route, kind, sum(count)::text AS count, max(last_at) AS last_at,
                count(*) OVER ()::text AS groups, sum(sum(count)) OVER ()::text AS all_count
           FROM server_errors_daily
          WHERE day > (now() AT TIME ZONE 'UTC')::date - $1::int
          GROUP BY route, kind
          ORDER BY max(last_at) DESC
          LIMIT ${MAX_LINES}`,
        [days],
      );
      const merged = new Map<string, ServerErrorLine>();
      for (const r of rows)
        merged.set(`${r.route}|${r.kind}`, {
          route: r.route,
          kind: r.kind,
          count: Number(r.count),
          lastAt: new Date(r.last_at).toISOString(),
        });
      // The first day of the window, UTC.
      const since = new Date(Date.now() - (days - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      let total = rows.length ? Number(rows[0].all_count) : 0;
      for (const p of this.pendingLines().filter((x) => x.day >= since)) {
        total += p.count;
        const key = `${p.route}|${p.kind}`;
        const m = merged.get(key);
        if (m) {
          m.count += p.count;
          if (p.lastAt > m.lastAt) m.lastAt = p.lastAt;
        } else
          merged.set(key, {
            route: p.route,
            kind: p.kind,
            count: p.count,
            lastAt: p.lastAt,
          });
      }
      const all = [...merged.values()].sort((a, b) =>
        b.lastAt.localeCompare(a.lastAt),
      );
      return {
        since,
        total,
        truncated:
          (rows.length ? Number(rows[0].groups) > MAX_LINES : false) ||
          all.length > MAX_LINES ||
          this.capHit,
        lines: all.slice(0, MAX_LINES),
      };
    } catch {
      return null;
    }
  }

  /** Older days go, each night (UTC, as the days are). */
  @Cron('25 4 * * *', { name: 'server-errors-prune', timeZone: 'UTC' })
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
