import type { DataSource } from 'typeorm';
import { EventEmitter } from 'events';
import { BadRequestException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import {
  ServerErrorKindInterceptor,
  ServerErrors,
  ServerErrorsMiddleware,
} from './server-errors';

/** No table in a unit test: every write fails quietly, as when the database is down. */
const noTable = {
  query: () => Promise.reject(new Error('no database')),
} as unknown as DataSource;

describe('the server’s own failures, counted (27 November 2026)', () => {
  /** One answer: the middleware sees it finish with this status. */
  const answer = (
    errors: ServerErrors,
    status: number,
    opts: { path?: string; kind?: string } = {},
  ) => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: status,
      locals: opts.kind ? { serverErrorKind: opts.kind } : {},
    });
    const req = {
      method: 'GET',
      baseUrl: '',
      route:
        opts.path === undefined
          ? { path: '/api/x/:id' }
          : opts.path
            ? { path: opts.path }
            : undefined,
    };
    new ServerErrorsMiddleware(errors).use(req, res, () => undefined);
    res.emit('finish');
  };

  it('every 5xx counts, wherever raised; a refusal (4xx) and a success do not', () => {
    const errors = new ServerErrors(noTable);
    answer(errors, 500, { kind: 'TypeError' });
    answer(errors, 500); // raised in a guard: no class known
    answer(errors, 503);
    answer(errors, 404);
    answer(errors, 200);
    expect(errors.count()).toBe(3);
    expect(
      errors
        .list()
        .map((l) => [l.route, l.kind, l.count])
        .sort(),
    ).toEqual([
      ['GET /api/x/:id', 'TypeError', 1],
      ['GET /api/x/:id', 'unknown', 2],
    ]);
  });

  it('the route’s pattern, never a raw path; nothing that was sent', () => {
    const errors = new ServerErrors(noTable);
    answer(errors, 500, { path: '' });
    expect(errors.list()[0].route).toBe('GET (no route)');
  });

  it('the handler’s error class is left for the count — the error itself goes on', async () => {
    const res = { locals: {} as Record<string, unknown> };
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => res }),
    } as never;
    const boom = new BadRequestException('Anna Müller');
    await expect(
      lastValueFrom(
        new ServerErrorKindInterceptor().intercept(ctx, {
          handle: () => throwError(() => boom),
        }),
      ),
    ).rejects.toBe(boom);
    expect(res.locals.serverErrorKind).toBe('BadRequestException');
  });

  it('distinct lines stop at a hundred, and the list says it is not all', () => {
    const errors = new ServerErrors(noTable);
    for (let i = 0; i < 150; i++) errors.record(`GET /r${i}`, 'Error');
    expect(errors.list()).toHaveLength(100);
    expect([errors.count(), errors.truncated()]).toEqual([150, true]);
  });
});
