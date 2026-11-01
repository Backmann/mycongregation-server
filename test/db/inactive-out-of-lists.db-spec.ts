import { Harness, startHarness } from './harness';

/**
 * Who is inactive is for elders only, and an inactive publisher is given no
 * task (Lionel, 31 October 2026). Against a real database, 1 November 2026:
 * - nobody but an elder or admin finds an inactive publisher in the roster,
 *   private access or a responsibility notwithstanding — the duties planner
 *   (a ministerial servant) was offered one by «Заполнить пустые»;
 * - the totals and a search tell nothing about who was left out;
 * - the group's overseer or assistant still sees his group's inactive on the
 *   group's own screen, where he collects their reports (22 October);
 * - nobody inactive is put forward for a part.
 */
describe('inactive publishers stay out of everybody else’s lists (real database)', () => {
  let h: Harness;
  let groupId: string;
  const ids: Record<string, string> = {};

  const setStatus = (id: string, status: string) =>
    h.sql(
      `UPDATE publishers SET status = $1, status_manually_overridden = true WHERE id = $2`,
      [status, id],
    );
  const intoGroup = (id: string) =>
    h.sql(`UPDATE publishers SET service_group_id = $1 WHERE id = $2`, [
      groupId,
      id,
    ]);

  beforeAll(async () => {
    h = await startHarness();
    const g = await h.as('admin').post('/service-groups', { name: 'Тишина' });
    expect(g.status).toBe(201);
    groupId = g.body.id;

    ids.away = await h.addPublisher({
      firstName: 'Ушедший',
      lastName: 'Неслышный',
      appointment: 'publisher',
      baptismDate: '2000-01-01',
    });
    await intoGroup(ids.away);
    await setStatus(ids.away, 'inactive');

    // The duties planner: a ministerial servant holding a responsibility.
    ids.planner = await h.addPublisher({
      firstName: 'Плановый',
      lastName: 'Тест',
      appointment: 'ministerial_servant',
      baptismDate: '2001-01-01',
    });
    await setStatus(ids.planner, 'active');
    ids.plannerUser = await h.addUser({
      login: 'planner',
      role: 'ministerial_servant',
      publisherId: ids.planner,
    });
    const r = await h.as('admin').post('/responsibilities', {
      type: 'duties_coordinator',
      userId: ids.plannerUser,
    });
    expect(r.status).toBe(201);

    // A ministerial servant granted private access.
    ids.trusted = await h.addPublisher({
      firstName: 'Доверенный',
      lastName: 'Тест',
      appointment: 'ministerial_servant',
      baptismDate: '2001-01-01',
    });
    await setStatus(ids.trusted, 'active');
    ids.trustedUser = await h.addUser({
      login: 'trusted',
      role: 'ministerial_servant',
      publisherId: ids.trusted,
    });
    await h.sql(`UPDATE users SET can_view_private_data = true WHERE id = $1`, [
      ids.trustedUser,
    ]);

    // The group's assistant, a ministerial servant.
    ids.helper = await h.addPublisher({
      firstName: 'Помогающий',
      lastName: 'Тест',
      appointment: 'ministerial_servant',
      baptismDate: '2001-01-01',
    });
    await intoGroup(ids.helper);
    await setStatus(ids.helper, 'active');
    await h.sql(
      `UPDATE service_groups SET assistant_publisher_id = $1 WHERE id = $2`,
      [ids.helper, groupId],
    );
    await h.addUser({
      login: 'helper',
      role: 'ministerial_servant',
      publisherId: ids.helper,
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const roster = async (who: string, q = 'limit=200') => {
    const res = await h.as(who).get(`/publishers?${q}`);
    expect([who, res.status]).toEqual([who, 200]);
    return res.body as { data: { id: string }[]; total: number };
  };
  const has = (page: { data: { id: string }[] }, id: string) =>
    page.data.some((p) => p.id === id);

  it('an elder (admin) still finds him', async () => {
    expect(has(await roster('admin'), ids.away)).toBe(true);
  });

  it('the duties planner, the trusted servant and the group assistant do not', async () => {
    for (const who of ['planner', 'trusted', 'helper'])
      expect([who, has(await roster(who), ids.away)]).toEqual([who, false]);
  });

  it('the totals and a search give nothing away', async () => {
    for (const who of ['planner', 'trusted']) {
      const all = await roster(who);
      expect([who, all.total]).toEqual([who, all.data.length]);
      const one = await roster(who, 'limit=1');
      expect([who, one.total]).toEqual([who, all.total]);
      const found = await roster(who, 'search=Неслышный');
      expect([who, found.total, found.data.length]).toEqual([who, 0, 0]);
    }
    const elder = await roster('admin', 'search=Неслышный');
    expect(elder.total).toBe(1);
  });

  it("the group's assistant still sees him on the group's own screen", async () => {
    const res = await h
      .as('helper')
      .get(`/service-groups/${groupId}/publishers?limit=200`);
    expect(res.status).toBe(200);
    expect(has(res.body, ids.away)).toBe(true);
  });

  it('a trusted servant who does not lead the group sees him nowhere, nor in its size', async () => {
    const res = await h
      .as('trusted')
      .get(`/service-groups/${groupId}/publishers?limit=200`);
    expect(res.status).toBe(200);
    expect(has(res.body, ids.away)).toBe(false);
    expect(res.body.total).toBe(res.body.data.length);

    const groups = await h.as('trusted').get('/service-groups');
    const mine = (
      groups.body.data as { id: string; memberCount: number }[]
    ).find((g) => g.id === groupId)!;
    expect(mine.memberCount).toBe(res.body.data.length);
    const elders = await h.as('admin').get('/service-groups');
    const full = (
      elders.body.data as { id: string; memberCount: number }[]
    ).find((g) => g.id === groupId)!;
    expect(full.memberCount).toBe(mine.memberCount + 1);
  });

  it('a private date is no sort order for those who may not read it', async () => {
    const a = await roster('planner', 'limit=200&sortBy=baptismDate');
    const b = await roster('planner', 'limit=200&sortBy=lastName');
    expect(a.data.map((p) => p.id)).toEqual(b.data.map((p) => p.id));
  });

  it('nobody inactive is put forward for a part', async () => {
    const [{ congregation_id: tenantId }] = await h.sql<{
      congregation_id: string;
    }>(`SELECT congregation_id FROM publishers WHERE id = $1`, [ids.away]);
    await h.sql(
      `INSERT INTO assignments (congregation_id, event_type, week_start_date, part_key, publisher_id, assistant_publisher_id)
       VALUES ($1, 'midweek', current_date - 14 - extract(isodow from current_date)::int + 1, 'bible_reading', $2, NULL),
              ($1, 'midweek', current_date - 21 - extract(isodow from current_date)::int + 1, 'bible_reading', $3, NULL)`,
      [tenantId, ids.away, ids.helper],
    );
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const week = monday.toISOString().slice(0, 10);
    const res = await h
      .as('planner')
      .get(
        `/publisher-activity/suggestions?weekStart=${week}&partKeys=bible_reading`,
      );
    expect(res.status).toBe(200);
    const who = (res.body as { publisherId: string }[]).map(
      (s) => s.publisherId,
    );
    expect(who).toContain(ids.helper);
    expect(who).not.toContain(ids.away);
  });

  it('a brother just entered — baptized long ago, no reports here — is not inactive', async () => {
    const made = await h.as('admin').post('/publishers', {
      firstName: 'Переехавший',
      lastName: 'Новый',
      gender: 'brother',
      appointment: 'publisher',
      baptismDate: '1999-03-03',
    });
    expect(made.status).toBe(201);
    expect(made.body.status).not.toBe('inactive');
    const [{ status }] = await h.sql<{ status: string }>(
      `SELECT status FROM publishers WHERE id = $1`,
      [made.body.id],
    );
    expect(status).not.toBe('inactive');
    expect(has(await roster('trusted'), made.body.id)).toBe(true);
    expect(has(await roster('planner'), made.body.id)).toBe(true);
  });
});
