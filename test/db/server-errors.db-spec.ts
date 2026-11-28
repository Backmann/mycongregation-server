import { Harness, startHarness } from './harness';
import { ServerErrors } from '../../src/server-errors/server-errors';

/**
 * The server's 5xx, counted wherever raised, shown to the platform owner
 * (27 November 2026). A real failure: a table renamed away for a moment.
 */
describe('the server’s failures from the browser', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.addUser({ login: 'plain', role: 'publisher' });
    const elder = await h.addPublisher({
      firstName: 'Другой',
      lastName: 'Админ',
      appointment: 'elder',
      baptismDate: '2000-01-01',
    });
    // An administrator of the congregation who is not the platform owner.
    await h.addUser({
      login: 'otheradmin',
      role: 'elder',
      publisherId: elder,
    });
    await h.sql(
      `UPDATE users SET role = 'admin' WHERE login_name = 'otheradmin'`,
    );
    await h.sql(
      `UPDATE users SET is_owner = true WHERE login_name = 'dbtest-admin'`,
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('public health says nothing new', async () => {
    const r = await h.as(null).get('/health');
    expect(Object.keys(r.body).sort()).toEqual(
      ['commit', 'status', 'timestamp', 'uptime'].sort(),
    );
  });

  it('a real 5xx — in a handler and in a guard — is counted with its route', async () => {
    const lines = async () =>
      (await h.as('admin').get('/health/errors')).body.lines as {
        route: string;
        kind: string;
        count: number;
      }[];
    // In a handler: the songs it reads are gone for a moment.
    await h.sql(`ALTER TABLE songs RENAME TO songs_gone`);
    const failed = await h.as('admin').get('/songs');
    await h.sql(`ALTER TABLE songs_gone RENAME TO songs`);
    expect(failed.status).toBe(500);
    // In a guard: the responsibilities a guard reads are gone for a moment.
    await h.sql(`ALTER TABLE responsibilities RENAME TO responsibilities_gone`);
    const guarded = await h.as('plain').get('/readiness');
    await h.sql(`ALTER TABLE responsibilities_gone RENAME TO responsibilities`);
    // The table is written beside the answer, not before it: wait for it.
    let got = await lines();
    for (
      let i = 0;
      i < 40 && !got.some((l) => l.route === 'GET /api/readiness');
      i++
    ) {
      await new Promise((r) => setTimeout(r, 50));
      got = await lines();
    }
    expect(got).toContainEqual(
      expect.objectContaining({
        route: 'GET /api/songs',
        kind: 'QueryFailedError',
      }),
    );
    expect(guarded.status).toBe(500);
    // Raised in a guard, before any handler: counted all the same.
    expect(got).toContainEqual(
      expect.objectContaining({ route: 'GET /api/readiness', kind: 'unknown' }),
    );
    expect(JSON.stringify(got)).not.toContain('songs_gone');
  });

  it('kept across a restart: the table answers, not the memory (28 November 2026)', async () => {
    // The write is not awaited by the answer: wait for the row.
    let rows: { route: string; kind: string; count: number }[] = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      rows = await h.sql(
        `SELECT route, kind, count FROM server_errors_daily WHERE route = 'GET /api/songs'`,
      );
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(rows).toEqual([
      { route: 'GET /api/songs', kind: 'QueryFailedError', count: 1 },
    ]);
    // A restart: this process forgets everything it counted.
    const mem = h.app.get(ServerErrors) as unknown as {
      lines: Map<string, unknown>;
      total: number;
    };
    mem.lines.clear();
    mem.total = 0;
    const after = await h.as('admin').get('/health/errors');
    expect(after.body.source).toBe('table');
    expect(after.body.lines).toContainEqual(
      expect.objectContaining({ route: 'GET /api/songs', count: 1 }),
    );
    expect(after.body.total).toBeGreaterThanOrEqual(2);
  });

  it('a write that failed is kept and written later — nothing told is lost', async () => {
    // The table is away for a moment: the failure is counted, not written.
    await h.sql(
      `ALTER TABLE server_errors_daily RENAME TO server_errors_daily_gone`,
    );
    await h.sql(`ALTER TABLE songs RENAME TO songs_gone`);
    const failed = await h.as('admin').get('/songs');
    await h.sql(`ALTER TABLE songs_gone RENAME TO songs`);
    expect(failed.status).toBe(500);
    await new Promise((r) => setTimeout(r, 200));
    await h.sql(
      `ALTER TABLE server_errors_daily_gone RENAME TO server_errors_daily`,
    );
    // Shown at once, though not in the table yet.
    const shown = await h.as('admin').get('/health/errors');
    expect(shown.body.source).toBe('table');
    expect(shown.body.lines).toContainEqual(
      expect.objectContaining({ route: 'GET /api/songs', count: 2 }),
    );
    const writer = h.app.get(ServerErrors) as unknown as {
      write(force?: boolean): Promise<void>;
    };
    // Meanwhile a try waits for the retry timer: nothing written yet.
    await writer.write();
    const [early] = await h.sql<{ count: number }>(
      `SELECT count FROM server_errors_daily WHERE route = 'GET /api/songs'`,
    );
    expect(early.count).toBe(1);
    // The timer's own try (here asked at once): written, nothing lost.
    await writer.write(true);
    const [row] = await h.sql<{ count: number }>(
      `SELECT count FROM server_errors_daily WHERE route = 'GET /api/songs'`,
    );
    expect(row.count).toBe(2);
  });

  it('days ask a window; old days go at night', async () => {
    await h.sql(
      `INSERT INTO server_errors_daily (day, route, kind, count)
       VALUES ((now() AT TIME ZONE 'UTC')::date - 3, 'GET /api/three-days', 'TypeError', 4),
              ((now() AT TIME ZONE 'UTC')::date - 40, 'GET /api/forty-days', 'TypeError', 1)`,
    );
    const routes = async (q: string) =>
      (
        (await h.as('admin').get(`/health/errors${q}`)).body.lines as {
          route: string;
        }[]
      ).map((l) => l.route);
    expect(await routes('?days=1')).not.toContain('GET /api/three-days');
    expect(await routes('?days=7')).toContain('GET /api/three-days');
    expect(await routes('?days=7')).not.toContain('GET /api/forty-days');
    await h.app.get(ServerErrors).prune();
    const left = await h.sql<{ route: string }>(
      `SELECT route FROM server_errors_daily`,
    );
    expect(left.map((r) => r.route)).toContain('GET /api/three-days');
    expect(left.map((r) => r.route)).not.toContain('GET /api/forty-days');
  });

  it('the platform owner only: not another administrator, not a member', async () => {
    const own = await h.as('admin').get('/health/errors');
    expect(own.status).toBe(200);
    // The database tests run with 1.x's rule; the live answer says which.
    expect(own.body.whereRule).toBe('throw');
    expect((await h.as('otheradmin').get('/health/errors')).status).toBe(403);
    expect((await h.as('plain').get('/health/errors')).status).toBe(403);
    expect((await h.as(null).get('/health/errors')).status).toBe(401);
  });
});
