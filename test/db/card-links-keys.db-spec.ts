import { Harness, startHarness } from './harness';

/**
 * Every link to a publisher card is a key the database knows (1 November
 * 2026). Five were plain ids: «Удалить насовсем» did not see them, and a
 * group's overseer could be deleted out from under his group.
 */
describe('links to a card are database keys (real database)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const LINKS: [string, string][] = [
    ['service_groups', 'overseer_publisher_id'],
    ['assignment_notices', 'partner_publisher_id'],
    ['pair_agreements', 'holder_publisher_id'],
    ['pair_agreements', 'assistant_publisher_id'],
    ['pair_agreements', 'proposed_by_publisher_id'],
    ['service_groups', 'assistant_publisher_id'],
    ['field_service_meetings', 'service_overseer_publisher_id'],
    ['field_service_meetings', 'service_overseer_assistant_id'],
    ['elder_tasks', 'assignee_publisher_id'],
    ['special_events', 'co_accommodation_publisher_id'],
  ];

  it('the database knows each of them as a link to a card', async () => {
    const keys = await h.sql<{ t: string; c: string }>(
      `SELECT c.conrelid::regclass::text AS t, a.attname AS c
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'publishers'::regclass`,
    );
    const known = new Set(keys.map((k) => `${k.t}.${k.c}`));
    for (const [t, c] of LINKS) expect(known).toContain(`${t}.${c}`);
  });

  it('no column that names a card is left outside the keys', async () => {
    // A column whose name says it holds a card, and no key behind it: the
    // gap this closes, kept closed for whatever is added next.
    const loose = await h.sql<{ t: string; c: string }>(
      `SELECT col.table_name AS t, col.column_name AS c
         FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.data_type = 'uuid'
          AND col.column_name LIKE '%publisher%'
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint k
              JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)
             WHERE k.contype = 'f'
               AND k.conrelid::regclass::text = col.table_name
               AND a.attname = col.column_name)`,
    );
    expect(loose).toEqual([]);
  });

  it('a group overseer’s card cannot be deleted for good, and says why', async () => {
    const g = await h.as('admin').post('/service-groups', { name: 'Ключ' });
    expect(g.status).toBe(201);
    const id = await h.addPublisher({
      firstName: 'Надзиратель',
      lastName: 'Ключевой',
      appointment: 'elder',
      baptismDate: '2001-01-01',
    });
    await h.sql(
      `UPDATE service_groups SET overseer_publisher_id = $1 WHERE id = $2`,
      [id, g.body.id],
    );
    const r = await h.as('admin').delete(`/publishers/${id}`);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('service_groups=1');
    const still = await h.sql(`SELECT 1 FROM publishers WHERE id = $1`, [id]);
    expect(still).toHaveLength(1);
  });

  it('an id naming no card is refused by the database itself', async () => {
    const g = await h.as('admin').post('/service-groups', { name: 'Пустота' });
    await expect(
      h.sql(
        `UPDATE service_groups SET assistant_publisher_id = gen_random_uuid() WHERE id = $1`,
        [g.body.id],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
