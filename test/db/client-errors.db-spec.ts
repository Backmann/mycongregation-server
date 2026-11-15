import { Harness, startHarness } from './harness';
import {
  ClientErrorsService,
  NETWORK_FLOOD,
} from '../../src/client-errors/client-errors.service';

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
    // Whoever runs the platform: the first administrator. A second one runs
    // only the congregation (15 November 2026).
    await h.sql(
      `UPDATE users SET is_owner = true WHERE login_name = 'dbtest-admin'`,
    );
    await h.addUser({ login: 'ceadmin2', role: 'publisher' });
    await h.sql(
      `UPDATE users SET role = 'admin' WHERE login_name = 'ceadmin2'`,
    );
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

  it('whoever runs the platform hears of a new kind once a day; other administrators do not', async () => {
    const sent = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM notification_outbox WHERE kind = 'client_error'`,
    );
    expect(Number(sent[0].n)).toBe(1);
    const to = await h.sql<{ owner: boolean }>(
      `SELECT u.is_owner AS owner FROM notification_outbox o JOIN users u ON u.id = o.user_id
        WHERE o.kind = 'client_error'`,
    );
    expect(to).toEqual([{ owner: true }]);

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

  it('read by whoever runs the platform only', async () => {
    expect((await h.as('cepub1').get('/client-errors')).status).toBe(403);
    expect((await h.as('ceadmin2').get('/client-errors')).status).toBe(403);
    const me = await h.as('ceadmin2').get('/auth/me');
    expect(me.body.canSeeCrashes).toBe(false);
    expect((await h.as('admin').get('/auth/me')).body.canSeeCrashes).toBe(true);
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

  it('a failure of code the app never runs (a console, an extension) is kept, not told', async () => {
    const svc = h.app.get(ClientErrorsService);
    // A day of its own: nothing else has been told on it.
    const day = new Date(Date.now() - 5 * 86_400_000);
    const count = async () =>
      Number(
        (
          await h.sql<{ n: string }>(
            `SELECT count(*) AS n FROM notification_outbox WHERE kind = 'client_error'`,
          )
        )[0].n,
      );
    const before = await count();
    await svc.record(
      {
        ...report,
        source: 'uncaught',
        route: '/cart/desk',
        message: 'TypeError: ts is not iterable',
        stack: 'TypeError: ts is not iterable\n    at <anonymous>:1:297',
      } as never,
      day,
    );
    const kept = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM client_errors WHERE route = '/cart/desk'`,
    );
    expect(kept[0].n).toBe('1');
    expect(await count()).toBe(before);
    // The same day still tells of a failure of the app's own code.
    await svc.record({ ...report, route: '/own' } as never, day);
    expect(await count()).toBeGreaterThan(before);
  });

  const told = async () =>
    Number(
      (
        await h.sql<{ n: string }>(
          `SELECT count(*) AS n FROM notification_outbox WHERE kind = 'client_error'`,
        )
      )[0].n,
    );

  it('a request that did not get through is kept as the network, told only when it floods', async () => {
    const svc = h.app.get(ClientErrorsService);
    // A day of its own: nothing else has been told on it.
    const day = new Date(Date.now() - 7 * 86_400_000);
    const net = {
      platform: 'web',
      source: 'uncaught',
      route: '/login',
      message: 'NetworkError: A network error occurred.',
      event: 'rejection',
      online: true,
      place: 'https://example.org/_expo/static/js/web/entry-4f3a9.js:2:120',
      sinceStartS: 3,
    } as never;
    const before = await told();
    for (let i = 1; i < NETWORK_FLOOD; i++) await svc.record(net, day);
    expect(await told()).toBe(before);
    // The context is kept as told.
    const [row] = await h.sql<{
      event: string;
      online: boolean;
      place: string;
      since_start_s: number;
      count: number;
    }>(
      `SELECT event, online, place, since_start_s, count FROM client_errors WHERE route = '/login'`,
    );
    expect(row).toEqual({
      event: 'rejection',
      online: true,
      place: 'https://example.org/_expo/static/js/web/entry-4f3a9.js:2:120',
      since_start_s: 3,
      count: NETWORK_FLOOD - 1,
    });
    // An older build's report (no context) does not wipe it.
    await svc.record(
      { ...(net as object), event: undefined, online: undefined } as never,
      day,
    );
    expect(await told()).toBeGreaterThan(before);
    const [after] = await h.sql<{ event: string; online: boolean }>(
      `SELECT event, online FROM client_errors WHERE route = '/login'`,
    );
    expect(after).toEqual({ event: 'rejection', online: true });
    // Told once only, however many more.
    const once = await told();
    await svc.record(net, day);
    expect(await told()).toBe(once);
    // The administrator sees it marked as the network's.
    const res = await h.as('admin').get('/client-errors');
    const login = res.body.find((r: { route: string }) => r.route === '/login');
    expect(login.network).toBe(true);
    expect(
      res.body.find((r: { route: string }) => r.route === '/home').network,
    ).toBe(false);
  });

  it('offline, any failure is the network; a new report field is checked', async () => {
    const svc = h.app.get(ClientErrorsService);
    const day = new Date(Date.now() - 9 * 86_400_000);
    const before = await told();
    await svc.record(
      {
        ...report,
        route: '/offline',
        message: 'TypeError: x is undefined',
        online: false,
      } as never,
      day,
    );
    expect(await told()).toBe(before);
    expect(
      (await h.as(null).post('/client-errors', { ...report, event: 'click' }))
        .status,
    ).toBe(400);
    expect(
      (
        await h.as(null).post('/client-errors', {
          ...report,
          route: '/ctx',
          online: true,
          event: 'error',
          sinceStartS: 4,
        })
      ).status,
    ).toBe(204);
  });

  it('nobody marked as running the platform: the failure is kept, nobody is told', async () => {
    const svc = h.app.get(ClientErrorsService);
    await h.sql(`UPDATE users SET is_owner = false`);
    try {
      const day = new Date(Date.now() - 11 * 86_400_000);
      const before = await told();
      await svc.record({ ...report, route: '/nobody' } as never, day);
      expect(await told()).toBe(before);
      expect(
        await h.sql(`SELECT 1 FROM client_errors WHERE route = '/nobody'`),
      ).toHaveLength(1);
    } finally {
      await h.sql(
        `UPDATE users SET is_owner = true WHERE login_name = 'dbtest-admin'`,
      );
    }
  });
});
