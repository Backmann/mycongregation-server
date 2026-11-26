import { Harness, startHarness } from './harness';
import { ConventionRulesService } from '../../src/announcements/convention-rules.service';

/**
 * BEFORE A CONVENTION (announcements R-04 (2), (3), R-05) on a real database:
 * the chairman's «programme on the screens» put on his list by the app, the
 * overseer's tasks, and taking the item off for good.
 */
type Who = 'admin' | 'bc' | 'lmm' | 'elder' | 'pub';
const WHO: Who[] = ['admin', 'bc', 'lmm', 'elder', 'pub'];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(iso, 1 - dow);
}

describe('convention rules (real database)', () => {
  let h: Harness;
  let tenant: string;
  let rules: ConventionRulesService;
  let lmmCard: string;
  const login = (w: Who) => (w === 'admin' ? 'admin' : `conv${w}user`);
  // The congregation's own day (Berlin), never UTC.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
  }).format(new Date());
  const THIS = monday(today);
  // A one-day assembly on the Sunday of the week after next: its week holds
  // no meetings, so the item goes to next week's Wednesday — inside the
  // three weeks, and still ahead whatever day the test runs.
  const ASSEMBLY = addDays(THIS, 20);
  const WEDNESDAY = addDays(THIS, 9);
  const REGIONAL = addDays(today, 40);

  const screens = (w: Who) =>
    h.as(login(w)).get(`/announcements/screens?date=${ASSEMBLY}`);
  const item = async () =>
    h.sql<{ week: string; by_rule: boolean; source: string }>(
      `SELECT to_char(week_start_date, 'YYYY-MM-DD') AS week, by_rule, source
         FROM meeting_announcements WHERE congregation_id = $1 AND source = 'assembly_screens'`,
      [tenant],
    );

  const tasksOf = async (kind: string) =>
    (
      await h.sql<{ period: string }>(
        `SELECT kind_period AS period FROM elder_tasks WHERE congregation_id = $1 AND kind = $2 ORDER BY kind_period`,
        [tenant, kind],
      )
    ).map((r) => r.period);
  const moveAssembly = (date: string) =>
    h.sql(
      `UPDATE special_events SET date = $2 WHERE congregation_id = $1 AND type = 'circuit_assembly'`,
      [tenant, date],
    );
  const journalCount = async () =>
    Number(
      (
        await h.sql<{ n: string }>(
          `SELECT count(*) AS n FROM audit_logs WHERE congregation_id = $1`,
          [tenant],
        )
      )[0].n,
    );

  beforeAll(async () => {
    h = await startHarness();
    rules = h.app.get(ConventionRulesService);
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2026-01-05',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Musterstraße 1, 59065 Hamm',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    const person = async (w: Who, role: string, resp?: string) => {
      const id = await h.addPublisher({
        firstName: w,
        lastName: 'Конгресс',
        appointment: role === 'publisher' ? 'publisher' : role,
        baptismDate: '2000-01-01',
      });
      const uid = await h.addUser({
        login: login(w),
        role: role as 'elder',
        publisherId: id,
      });
      if (resp)
        await h.sql(
          `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
          [tenant, resp, uid],
        );
      return id;
    };
    await person('bc', 'elder', 'body_coordinator');
    lmmCard = await person('lmm', 'elder', 'life_ministry_overseer');
    await person('elder', 'elder');
    await person('pub', 'publisher');
    for (const [type, date] of [
      ['circuit_assembly', ASSEMBLY],
      ['regional_convention', REGIONAL],
    ]) {
      const r = await h.as('admin').post('/special-events', {
        type,
        title: type,
        date,
      });
      expect(r.status).toBe(201);
    }
  });
  afterAll(async () => {
    await h?.close();
  });

  it('only the writers and the overseer of the Life and Ministry meeting see the item', async () => {
    const got: Record<string, number> = {};
    for (const w of WHO) got[w] = (await screens(w)).status;
    expect(got).toEqual({
      admin: 200,
      bc: 200,
      lmm: 200,
      elder: 403,
      pub: 403,
    });
    expect(
      (
        await h
          .as(login('pub'))
          .post('/announcements/screens/remove', { date: ASSEMBLY })
      ).status,
    ).toBe(403);
  });

  it('puts the item on the last midweek meeting before the assembly, marked by the guidelines', async () => {
    expect((await screens('lmm')).body.state).toBe('later');
    await rules.forCongregation(tenant);
    expect(await item()).toEqual([
      { week: addDays(THIS, 7), by_rule: true, source: 'assembly_screens' },
    ]);
    const s = (await screens('lmm')).body;
    expect(s).toEqual({ state: 'placed', meetingDate: WEDNESDAY, read: false });
    // Twice a day changes nothing.
    await rules.forCongregation(tenant);
    expect(await item()).toHaveLength(1);
  });

  it('gives the overseer his tasks, each once', async () => {
    const tasks = await h.sql<{ kind: string; period: string; due: string }>(
      `SELECT kind, kind_period AS period, to_char(due_date, 'YYYY-MM-DD') AS due
         FROM elder_tasks WHERE congregation_id = $1 AND kind IN ('assembly_screens', 'campaign_part')
        ORDER BY kind`,
      [tenant],
    );
    expect(tasks).toEqual([
      { kind: 'assembly_screens', period: ASSEMBLY, due: WEDNESDAY },
      { kind: 'campaign_part', period: REGIONAL, due: addDays(REGIONAL, -21) },
    ]);
    const who = await h.sql<{ publisher_id: string }>(
      `SELECT a.publisher_id FROM elder_task_assignees a JOIN elder_tasks t ON t.id = a.task_id
        WHERE t.congregation_id = $1 AND t.kind = 'assembly_screens'`,
      [tenant],
    );
    expect(who).toEqual([{ publisher_id: lmmCard }]);
    // A task deleted on purpose does not come back.
    await h.sql(
      `DELETE FROM elder_tasks WHERE congregation_id = $1 AND kind = 'campaign_part'`,
      [tenant],
    );
    await rules.forCongregation(tenant);
    const left = await h.sql(
      `SELECT 1 FROM elder_tasks WHERE congregation_id = $1 AND kind = 'campaign_part'`,
      [tenant],
    );
    expect(left).toEqual([]);
  });

  it('taken off by the overseer stays off; put back returns it', async () => {
    const before = await journalCount();
    const off = await h
      .as(login('lmm'))
      .post('/announcements/screens/remove', { date: ASSEMBLY });
    expect(off.status).toBe(204);
    expect(await journalCount()).toBe(before + 1);
    expect(await item()).toEqual([]);
    await rules.forCongregation(tenant);
    expect(await item()).toEqual([]);
    expect((await screens('lmm')).body.state).toBe('removed');

    const back = await h
      .as(login('lmm'))
      .post('/announcements/screens/restore', { date: ASSEMBLY });
    expect(back.status).toBe(204);
    expect(await item()).toHaveLength(1);
    expect(await journalCount()).toBe(before + 2);
  });

  it('deleted by a writer from the week, it does not come back either', async () => {
    const id = (
      await h.sql<{ id: string }>(
        `SELECT id FROM meeting_announcements WHERE congregation_id = $1 AND source = 'assembly_screens'`,
        [tenant],
      )
    )[0].id;
    expect(
      (await h.as(login('bc')).delete(`/announcements/${id}`)).status,
    ).toBe(204);
    await rules.forCongregation(tenant);
    expect(await item()).toEqual([]);
    expect((await screens('bc')).body.state).toBe('removed');
  });

  it('an assembly moved a week on takes its unread item along', async () => {
    await h
      .as(login('lmm'))
      .post('/announcements/screens/restore', { date: ASSEMBLY });
    expect(await item()).toHaveLength(1);
    await h.sql(
      `UPDATE special_events SET date = $2 WHERE congregation_id = $1 AND type = 'circuit_assembly'`,
      [tenant, addDays(ASSEMBLY, 7)],
    );
    await rules.forCongregation(tenant);
    expect((await item()).map((r) => r.week)).toEqual([addDays(THIS, 14)]);
    await h.sql(
      `UPDATE special_events SET date = $2 WHERE congregation_id = $1 AND type = 'circuit_assembly'`,
      [tenant, ASSEMBLY],
    );
    await rules.forCongregation(tenant);
    expect((await item()).map((r) => r.week)).toEqual([addDays(THIS, 7)]);
    // The task went with the date and came back with it (independent check:
    // it used to be lost for good).
    expect(await tasksOf('assembly_screens')).toEqual([ASSEMBLY]);
  });

  it('an item a writer carried, or the chairman ticked, stays where it is', async () => {
    const id = (
      await h.sql<{ id: string }>(
        `SELECT id FROM meeting_announcements WHERE congregation_id = $1 AND source = 'assembly_screens'`,
        [tenant],
      )
    )[0].id;
    const carried = await h.as(login('bc')).post(`/announcements/${id}/carry`, {
      weekStartDate: addDays(THIS, 7),
      eventType: 'weekend',
    });
    expect([200, 201]).toContain(carried.status);
    await moveAssembly(addDays(ASSEMBLY, 7));
    await rules.forCongregation(tenant);
    const rows = await h.sql<{ week: string; kind: string }>(
      `SELECT to_char(week_start_date, 'YYYY-MM-DD') AS week, event_type AS kind FROM meeting_announcements WHERE congregation_id = $1 AND source = 'assembly_screens'`,
      [tenant],
    );
    expect(rows).toEqual([{ week: addDays(THIS, 7), kind: 'weekend' }]);
    await moveAssembly(ASSEMBLY);
    // Ticked off by the chairman: history, not moved either.
    await h.sql(
      `UPDATE meeting_announcements SET read_at = now(), event_type = 'midweek', carried_from = NULL WHERE id = $1`,
      [id],
    );
    await moveAssembly(addDays(ASSEMBLY, 7));
    await rules.forCongregation(tenant);
    expect((await item()).map((r) => r.week)).toEqual([addDays(THIS, 7)]);
    await moveAssembly(ASSEMBLY);
    await h.sql(
      `UPDATE meeting_announcements SET read_at = NULL WHERE id = $1`,
      [id],
    );
    await rules.forCongregation(tenant);
  });

  it('a run that loses the race for the task does not fail', async () => {
    // What the second of two runs at once sees: the task is there, its log
    // line not yet (independent check: «duplicate key … uq_elder_tasks_kind_period»).
    await h.sql(
      `DELETE FROM elder_task_calendar_log WHERE congregation_id = $1 AND kind = 'assembly_screens'`,
      [tenant],
    );
    await expect(rules.forCongregation(tenant)).resolves.toBeDefined();
    expect(await tasksOf('assembly_screens')).toEqual([ASSEMBLY]);
  });

  it('two runs at once make one item and one task, and do not fail', async () => {
    await Promise.all([
      rules.forCongregation(tenant),
      rules.forCongregation(tenant),
      rules.forCongregation(tenant),
    ]);
    expect(await item()).toHaveLength(1);
    expect(await tasksOf('assembly_screens')).toEqual([ASSEMBLY]);
  });

  it('an assembly deleted takes its unread item and open task with it', async () => {
    await h
      .as(login('lmm'))
      .post('/announcements/screens/restore', { date: ASSEMBLY });
    expect(await item()).toHaveLength(1);
    expect(await tasksOf('assembly_screens')).toEqual([ASSEMBLY]);
    await h.sql(
      `UPDATE special_events SET deleted_at = now() WHERE congregation_id = $1 AND type = 'circuit_assembly'`,
      [tenant],
    );
    await rules.forCongregation(tenant);
    expect(await item()).toEqual([]);
    const task = await h.sql(
      `SELECT 1 FROM elder_tasks WHERE congregation_id = $1 AND kind = 'assembly_screens'`,
      [tenant],
    );
    expect(task).toEqual([]);
  });
});
