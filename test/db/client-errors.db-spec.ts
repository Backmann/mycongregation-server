import { Harness, startHarness } from './harness';
import { ClientErrorsService } from '../../src/client-errors/client-errors.service';

/**
 * The journal of failures met in the app, on the real database (10 November
 * 2026): a report is taken without signing in, scrubbed, folded into one row
 * per failure per day, read only by an administrator, and the
 * administrators hear of a new kind once.
 */
describe('failures met in the app (real database)', () => {
  let h: Harness;
  const report = {
    platform: 'web',
    source: 'screen',
    route: '/publishers/1a12bb63-6341-44da-a39f-c2db4d3d5c71?tab=2',
    message: 'Cannot read properties of undefined for lena@example.org',
    stack: 'at PublisherCard (entry-4f3a9.js:1:20301)\nat div',
    appCommit: 'abc1234',
    role: 'publisher',
  };

  beforeAll(async () => {
    h = await startHarness();
    await h.addUser({ login: 'cepub1', role: 'publisher' });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('taken without signing in; repeats counted; nothing that names a person kept', async () => {
    expect((await h.as(null).post('/client-errors', report)).status).toBe(204);
    expect((await h.as(null).post('/client-errors', report)).status).toBe(204);

    const rows = await h.sql<{
      route: string;
      message: string;
      count: number;
      role: string;
    }>(`SELECT route, message, count, role FROM client_errors`);
    expect(rows).toEqual([
      {
        route: '/publishers/[id]',
        message: 'Cannot read properties of undefined for <mail>',
        count: 2,
        role: 'publisher',
      },
    ]);
  });

  it('the administrators hear of a new kind once a day', async () => {
    const sent = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM notification_outbox WHERE kind = 'client_error'`,
    );
    const admins = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM users WHERE role = 'admin' AND is_active`,
    );
    expect(Number(sent[0].n)).toBe(Number(admins[0].n));

    await h.as(null).post('/client-errors', { ...report, route: '/home' });
    const after = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM notification_outbox WHERE kind = 'client_error'`,
    );
    expect(after[0].n).toBe(sent[0].n);
  });

  it('a failure known from an earlier day is not news again', async () => {
    const svc = h.app.get(ClientErrorsService);
    const known = { ...report, route: '/known' } as never;
    // Two past days of their own, so no key of today's hides the answer.
    const dayBefore = new Date(Date.now() - 3 * 86_400_000);
    const nextDay = new Date(Date.now() - 2 * 86_400_000);
    await svc.record(known, dayBefore);
    const before = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM notification_outbox WHERE kind = 'client_error'`,
    );
    await svc.record(known, nextDay);
    const after = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM notification_outbox WHERE kind = 'client_error'`,
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it('read by an administrator only', async () => {
    expect((await h.as('cepub1').get('/client-errors')).status).toBe(403);
    expect((await h.as(null).get('/client-errors')).status).toBe(401);
    const res = await h.as('admin').get('/client-errors');
    expect(res.status).toBe(200);
    expect(
      [...new Set(res.body.map((r: { route: string }) => r.route))].sort(),
    ).toEqual(['/home', '/known', '/publishers/[id]']);
  });

  it('a malformed or oversized report is refused', async () => {
    expect(
      (await h.as(null).post('/client-errors', { ...report, platform: 'pc' }))
        .status,
    ).toBe(400);
    expect(
      (
        await h
          .as(null)
          .post('/client-errors', { ...report, message: 'x'.repeat(5000) })
      ).status,
    ).toBe(400);
  });

  it('kept thirty days', async () => {
    await h.sql(
      `INSERT INTO client_errors (day, fingerprint, platform, route, source, message)
       VALUES (current_date - 31, 'old', 'web', '/x', 'screen', 'old')`,
    );
    await h.as('admin').get('/client-errors');
    expect(
      await h.sql(`SELECT 1 FROM client_errors WHERE fingerprint = 'old'`),
    ).toEqual([]);
  });
});
