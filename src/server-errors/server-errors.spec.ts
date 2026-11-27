import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { ServerErrors, ServerErrorsInterceptor } from './server-errors';

describe('the server’s own failures, counted (27 November 2026)', () => {
  const ctx = (method: string, path: string) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method, baseUrl: '', route: { path } }),
      }),
    }) as never;
  const fail = async (
    errors: ServerErrors,
    e: unknown,
    path = '/api/announcements/:id',
  ) => {
    const i = new ServerErrorsInterceptor(errors);
    await lastValueFrom(
      i.intercept(ctx('GET', path), { handle: () => throwError(() => e) }),
    ).catch(() => undefined);
  };

  it('a crash and a 500 count; a refusal (4xx) does not', async () => {
    const errors = new ServerErrors();
    await fail(errors, new TypeError('x of undefined'));
    await fail(errors, new InternalServerErrorException());
    await fail(errors, new BadRequestException('no'));
    expect(errors.count()).toBe(2);
    expect(
      errors
        .list()
        .map((l) => [l.route, l.kind, l.count])
        .sort(),
    ).toEqual([
      ['GET /api/announcements/:id', 'InternalServerErrorException', 1],
      ['GET /api/announcements/:id', 'TypeError', 1],
    ]);
  });

  it('the route’s pattern and the class only — never the message', async () => {
    const errors = new ServerErrors();
    await fail(errors, new Error('Anna Müller, +49 151 …'));
    expect(JSON.stringify(errors.list())).not.toContain('Anna');
  });

  it('the same failure again adds up; distinct routes stop at a hundred', async () => {
    const errors = new ServerErrors();
    await fail(errors, new TypeError());
    await fail(errors, new TypeError());
    expect(errors.list()[0].count).toBe(2);
    for (let i = 0; i < 150; i++) errors.record(`GET /r${i}`, 'Error');
    expect(errors.list()).toHaveLength(100);
    expect(errors.count()).toBe(152);
  });
});
