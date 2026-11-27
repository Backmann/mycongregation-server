import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NestMiddleware,
} from '@nestjs/common';
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
  private total = 0;
  private readonly lines = new Map<string, ServerErrorLine>();
  private dropped = false;

  record(route: string, kind: string, at = new Date()): void {
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
