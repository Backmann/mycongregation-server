import { DataSource } from 'typeorm';
import { Harness, startHarness } from './harness';
import { RETENTION_RULES } from '../../src/retention/retention-rules';

/**
 * Retention preview against a real database (31 October 2026): every rule
 * names a real column, the counts see only what is past its time, and
 * nothing at all is deleted.
 */
describe('retention preview (real database)', () => {
  let h: Harness;
  let tenantId: string;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('every rule points at a real column of a table that belongs to a congregation', () => {
    const ds = h.app.get(DataSource);
    for (const rule of RETENTION_RULES) {
      const meta = ds.getMetadata(rule.entity);
      const has = (p: string) => !!meta.findColumnWithPropertyPath(p);
      expect([rule.key, has('congregationId')]).toEqual([rule.key, true]);
      if (rule.kind === 'dated') {
        expect([rule.key, has(rule.column)]).toEqual([rule.key, true]);
        for (const p of Object.keys(rule.only ?? {}))
          expect([rule.key, has(p)]).toEqual([rule.key, true]);
      } else {
        expect([rule.key, !!meta.deleteDateColumn]).toEqual([rule.key, true]);
      }
    }
  });

  it('counts what is past its time, leaves the rest, and deletes nothing', async () => {
    await h.sql(`DELETE FROM absences WHERE congregation_id = $1`, [tenantId]);
    const pub = await h.addPublisher({
      firstName: 'retention',
      lastName: 'Тест',
    });
    // Ended two months ago (past), ended yesterday (kept), deleted 40 days
    // ago (past for the deleted-rows rule too).
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date, deleted_at)
       VALUES ($1, $2, current_date - 70, current_date - 61, NULL),
              ($1, $2, current_date - 5, current_date - 1, NULL),
              ($1, $2, current_date - 5, current_date - 1, now() - interval '40 days')`,
      [tenantId, pub],
    );

    const res = await h.as('admin').get('/retention/preview');
    expect(res.status).toBe(200);
    const rows = res.body as { key: string; count: number; basis: string }[];
    const row = (key: string) => rows.find((r) => r.key === key)!;
    expect(row('absences').count).toBe(1);
    expect(row('deleted:absences').count).toBe(1);
    expect(row('absences').basis).toMatch(/31\.10\.2026/);

    const [{ n }] = await h.sql<{ n: string }>(
      `SELECT count(*) AS n FROM absences WHERE congregation_id = $1`,
      [tenantId],
    );
    expect(Number(n)).toBe(3);
  });

  it('is for administrators only', async () => {
    const res = await h.as(null).get('/retention/preview');
    expect([401, 403]).toContain(res.status);
  });
});
