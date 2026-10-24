import { Harness, startHarness } from './harness';

/**
 * The live database's checks (migration 1916000000000-ProductionFacts,
 * 24 October 2026): the role may call them and read nothing else, each
 * answers with a number, and a broken rule shows.
 */
describe('production facts (real database)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  /** Run as the facts role, in a transaction thrown away afterwards. */
  const asFacts = async <T>(q: string): Promise<T> => {
    const qr = h.db.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();
      await qr.query('SET LOCAL ROLE mycongregation_facts');
      return (await qr.query(q)) as T;
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  };
  const facts = () =>
    asFacts<{ check_name: string; value: string; expect_zero: boolean }[]>(
      'SELECT * FROM facts.after_deploy()',
    );

  it('every rule holds on a database the app made, and the figures are there', async () => {
    const rows = await facts();
    const rules = rows.filter((r) => r.expect_zero);
    expect(rules.map((r) => r.check_name).sort()).toEqual([
      'facts_role_can_create_in_public',
      'facts_role_tables_readable',
      'fs_drafts_ahead_of_removed_groups',
      'school_absences_of_removed_schools',
      'school_duties_ahead_of_removed_helpers',
      'talk_lines_linked_to_missing_entry',
      'talk_weeks_with_two_incoming',
    ]);
    expect(rules.filter((r) => Number(r.value) !== 0)).toEqual([]);
    expect(rows.map((r) => r.check_name)).toEqual(
      expect.arrayContaining(['migrations_applied', 'postgres_major']),
    );
  });

  it('the role reads no table and creates nothing', async () => {
    await expect(asFacts('SELECT count(*) FROM publishers')).rejects.toThrow(
      /permission denied/,
    );
    await expect(asFacts('SELECT count(*) FROM users')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asFacts('CREATE TABLE public.facts_probe (i int)'),
    ).rejects.toThrow(/permission denied/);
  });

  it('a broken rule shows as a number', async () => {
    const g = await h.as('admin').post('/service-groups', { name: 'Ален' });
    expect(g.status).toBe(201);
    const [{ congregation_id: tenantId }] = await h.sql<{
      congregation_id: string;
    }>(`SELECT congregation_id FROM service_groups WHERE id = $1`, [g.body.id]);
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    // A draft left behind a removed group: the state the code now prevents,
    // written straight into the table.
    await h.sql(
      `INSERT INTO field_service_meetings
         (congregation_id, week_start_date, day_of_week, start_time, address,
          is_general, service_group_id, published_at)
       VALUES ($1, $2, 6, '10:00', '', false, $3, NULL)`,
      [tenantId, d.toISOString().slice(0, 10), g.body.id],
    );
    await h.sql(`UPDATE service_groups SET deleted_at = now() WHERE id = $1`, [
      g.body.id,
    ]);
    const row = (await facts()).find(
      (r) => r.check_name === 'fs_drafts_ahead_of_removed_groups',
    );
    expect(Number(row?.value)).toBe(1);
  });
});
