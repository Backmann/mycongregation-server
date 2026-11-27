import { Harness, startHarness } from './harness';

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
    const got = await lines();
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

  it('the platform owner only: not another administrator, not a member', async () => {
    expect((await h.as('admin').get('/health/errors')).status).toBe(200);
    expect((await h.as('otheradmin').get('/health/errors')).status).toBe(403);
    expect((await h.as('plain').get('/health/errors')).status).toBe(403);
    expect((await h.as(null).get('/health/errors')).status).toBe(401);
  });
});
