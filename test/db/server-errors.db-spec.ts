import { Harness, startHarness } from './harness';
import { ServerErrors } from '../../src/server-errors/server-errors';

/** /health counts the 5xx; the administrator sees where (27 November 2026). */
describe('the server’s failures from the browser', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.addUser({ login: 'plain', role: 'publisher' });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('health says how many, to anyone, and nothing more', async () => {
    const r = await h.as(null).get('/health');
    expect(r.status).toBe(200);
    expect(typeof r.body.errors5xx).toBe('number');
    expect(Object.keys(r.body).sort()).toEqual(
      ['commit', 'errors5xx', 'status', 'timestamp', 'uptime'].sort(),
    );
  });

  it('where and what kind — the administrator only', async () => {
    const before = (await h.as(null).get('/health')).body.errors5xx as number;
    h.app.get(ServerErrors).record('GET /api/x/:id', 'TypeORMError');
    expect((await h.as(null).get('/health')).body.errors5xx).toBe(before + 1);
    const admin = await h.as('admin').get('/health/errors');
    expect(admin.status).toBe(200);
    expect(admin.body.lines).toContainEqual(
      expect.objectContaining({
        route: 'GET /api/x/:id',
        kind: 'TypeORMError',
        count: 1,
      }),
    );
    expect((await h.as('plain').get('/health/errors')).status).toBe(403);
    expect((await h.as(null).get('/health/errors')).status).toBe(401);
  });
});
