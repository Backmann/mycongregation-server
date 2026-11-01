import { Harness, startHarness } from './harness';

/**
 * Before the hand-set statuses are let go (1 November 2026): the preview
 * says how many are held and which way each would move — and changes
 * nothing.
 */
describe('releasing hand-set statuses: the preview (real database)', () => {
  let h: Harness;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await startHarness();
    await h.sql(
      `UPDATE publishers SET status_manually_overridden = false WHERE status_manually_overridden`,
    );
    const card = (first: string) =>
      h.addPublisher({
        firstName: first,
        lastName: 'Тест',
        appointment: 'publisher',
        baptismDate: '2000-01-01',
      });
    ids.frozenInactive = await card('Замороженный');
    ids.frozenActive = await card('Отмеченный');
    ids.free = await card('Свободный');
    // Old cards: judged on their silence, like the ones made before today's
    // rule — no reports here, so «inactive» by the reports.
    await h.sql(
      `UPDATE publishers SET created_at = '2025-01-01', member_since = NULL WHERE id = ANY($1::uuid[])`,
      [Object.values(ids)],
    );
    await h.sql(
      `UPDATE publishers SET status = 'inactive', status_manually_overridden = true WHERE id = $1`,
      [ids.frozenInactive],
    );
    await h.sql(
      `UPDATE publishers SET status = 'active', status_manually_overridden = true WHERE id = $1`,
      [ids.frozenActive],
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('counts what letting go would do, by numbers only, and changes nothing', async () => {
    const res = await h.as('admin').get('/publishers/status-overrides/preview');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      held: 2,
      unchanged: 1,
      moves: { 'active→inactive': 1 },
    });
    const [{ n }] = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM publishers WHERE status_manually_overridden`,
    );
    expect(Number(n)).toBe(2);
  });

  it('is for administrators only', async () => {
    const res = await h.as(null).get('/publishers/status-overrides/preview');
    expect([401, 403]).toContain(res.status);
  });

  it('a status is no longer set by hand', async () => {
    const res = await h
      .as('admin')
      .patch(`/publishers/${ids.free}/status`, { status: 'active' });
    expect([res.status, res.body.code]).toEqual([
      400,
      'STATUS_BY_REPORTS_ONLY',
    ]);
    const [{ held }] = await h.sql<{ held: boolean }>(
      `SELECT status_manually_overridden AS held FROM publishers WHERE id = $1`,
      [ids.free],
    );
    expect(held).toBe(false);
  });
});
