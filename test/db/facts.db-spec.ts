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
      'overseer_without_visit',
      'school_absences_of_removed_schools',
      'school_duties_ahead_of_removed_helpers',
      'talk_guests_set_aside_by_gone_visit',
      'talk_lines_linked_to_missing_entry',
      'talk_weeks_with_two_incoming',
      'two_speakers_in_a_line',
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

  it('the overseer left in a week without a visit, and two speakers in a line, show', async () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 60);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const w = d.toISOString().slice(0, 10);
    const r = await h.as('admin').post('/assignments', {
      weekStartDate: w,
      eventType: 'weekend',
      partKey: 'public_talk_speaker',
    });
    expect(r.status).toBe(201);
    const [{ cid }] = await h.sql<{ cid: string }>(
      `SELECT congregation_id AS cid FROM assignments WHERE id = $1`,
      [r.body.id],
    );
    const [{ id: co }] = await h.sql<{ id: string }>(
      `INSERT INTO visiting_speakers (congregation_id, first_name, last_name, circuit_overseer)
       VALUES ($1, 'Андреас', 'Районный', true) RETURNING id`,
      [cid],
    );
    await h.sql(
      `UPDATE assignments SET speaker_name = 'Андреас Районный', visiting_speaker_id = $2 WHERE id = $1`,
      [r.body.id, co],
    );
    const value = async (name: string) =>
      Number((await facts()).find((x) => x.check_name === name)?.value);
    expect(await value('overseer_without_visit')).toBe(1);
    const p = await h.addPublisher({
      firstName: 'Юрген',
      lastName: 'Бауэр',
      baptismDate: '2000-01-01',
    });
    await h.sql(
      `UPDATE assignments SET publisher_id = $2, visiting_speaker_id = NULL WHERE id = $1`,
      [r.body.id, p],
    );
    expect(await value('two_speakers_in_a_line')).toBe(1);
  });

  it('a guest left set aside by a visit that is gone shows', async () => {
    const [{ cid }] = await h.sql<{ cid: string }>(
      `SELECT congregation_id AS cid FROM users LIMIT 1`,
    );
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 90);
    const date = d.toISOString().slice(0, 10);
    const [{ id: v }] = await h.sql<{ id: string }>(
      `INSERT INTO special_events (congregation_id, title, type, date, deleted_at)
       VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, now()) RETURNING id`,
      [cid, date],
    );
    // The state the code now prevents, written straight into the table.
    await h.sql(
      `INSERT INTO talk_exchange (congregation_id, direction, date, speaker_name, set_aside_by, deleted_at)
       VALUES ($1, 'incoming', $2, 'Пётр Гостев', $3, now())`,
      [cid, date, v],
    );
    const row = (await facts()).find(
      (r) => r.check_name === 'talk_guests_set_aside_by_gone_visit',
    );
    expect(Number(row?.value)).toBe(1);
  });
});
