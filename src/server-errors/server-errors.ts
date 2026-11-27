import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
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
 * after the server must see them from the browser: the count on /health, the
 * routes and kinds for an administrator. Patterns and class names only — no
 * message, no parameter, nothing a person typed: what failed where, not with
 * what.
 */
@Injectable()
export class ServerErrors {
  private total = 0;
  private readonly lines = new Map<string, ServerErrorLine>();

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
    if (this.lines.size >= MAX_LINES) return;
    this.lines.set(key, { route, kind, count: 1, lastAt: at.toISOString() });
  }

  count(): number {
    return this.total;
  }

  list(): ServerErrorLine[] {
    return [...this.lines.values()].sort((a, b) =>
      b.lastAt.localeCompare(a.lastAt),
    );
  }
}

/** Whether a thrown thing ends as a 5xx answer. */
export function isServerFailure(e: unknown): boolean {
  if (e instanceof HttpException) return e.getStatus() >= 500;
  return true;
}

@Injectable()
export class ServerErrorsInterceptor implements NestInterceptor {
  constructor(private readonly errors: ServerErrors) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((e: unknown) => {
        if (ctx.getType() === 'http' && isServerFailure(e)) {
          const req = ctx.switchToHttp().getRequest<{
            method?: string;
            route?: { path?: string };
            baseUrl?: string;
          }>();
          const path = `${req.baseUrl ?? ''}${req.route?.path ?? '?'}`;
          const kind =
            (e as { constructor?: { name?: string } })?.constructor?.name ||
            'Error';
          this.errors.record(`${req.method ?? '?'} ${path}`, kind);
        }
        return throwError(() => e);
      }),
    );
  }
}
