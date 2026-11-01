import { Harness, startHarness } from './harness';
import { InactiveHoldsService } from '../../src/tasks/inactive-holds.service';

/**
 * «Замена назначений: [имя]» (1 November 2026), against a real database:
 * raised for an inactive publisher who still holds something, shown to the
 * elders with what is left, lowered by itself when nothing is, not raised
 * again after an elder closed it — until a new lapse.
 */
describe('the elders’ task for an inactive publisher’s assignments (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let svc: InactiveHoldsService;
  let away: string;
  let partId: string;

  const monday = (weeks: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * weeks);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const setStatus = (id: string, status: string) =>
    h.sql(`UPDATE publishers SET status = $1 WHERE id = $2`, [status, id]);
  const tasks = () =>
    h.sql<{ id: string; status: string }>(
      `SELECT id, status FROM elder_tasks WHERE congregation_id = $1 AND kind = 'inactive_holds' ORDER BY created_at`,
      [tenantId],
    );

  beforeAll(async () => {
    h = await startHarness();
    svc = h.app.get(InactiveHoldsService);
    away = await h.addPublisher({
      firstName: 'Ушедший',
      lastName: 'Тест',
      appointment: 'publisher',
      baptismDate: '2000-01-01',
    });
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM publishers WHERE id = $1`,
      [away],
    );
    const part = await h.as('admin').post('/assignments', {
      weekStartDate: monday(2),
      eventType: 'midweek',
      partKey: 'bible_reading',
      partOrder: 3,
      partTitle: 'Чтение Библии',
      partDurationMin: 4,
      status: 'draft',
      publisherId: away,
    });
    expect(part.status).toBe(201);
    partId = part.body.id;
    await setStatus(away, 'inactive');
    await h.sql(
      `DELETE FROM elder_task_calendar_log WHERE kind = 'inactive_holds'`,
    );
    await h.sql(`DELETE FROM elder_tasks WHERE kind = 'inactive_holds'`);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('is raised once, for the body of elders, naming nobody in its words', async () => {
    expect(await svc.sync(tenantId, today())).toBe(1);
    expect(await svc.sync(tenantId, today())).toBe(0);
    // The stored title is encrypted at rest; read it as the app does.
    const list = await h.as('admin').get('/tasks?status=open');
    expect(list.status).toBe(200);
    const mine = (
      list.body as {
        kind: string | null;
        title: string;
        assigneeKind: string;
        status: string;
      }[]
    ).filter((t) => t.kind === 'inactive_holds');
    expect(mine).toEqual([
      expect.objectContaining({
        title: 'inactive_holds',
        assigneeKind: 'body_of_elders',
        status: 'open',
      }),
    ]);
  });

  it('shows the elders whose it is and what is left', async () => {
    const [t] = await tasks();
    const res = await h.as('admin').get(`/tasks/${t.id}/inactive-holds`);
    expect(res.status).toBe(200);
    expect(res.body.name).toMatch(/Ушедший/);
    expect(res.body.holds).toEqual([
      expect.objectContaining({ kind: 'part', label: 'Чтение Библии' }),
    ]);
  });

  it('closes by itself when the part goes to somebody else', async () => {
    const other = await h.addPublisher({
      firstName: 'Замена',
      lastName: 'Тест',
      appointment: 'publisher',
      baptismDate: '2000-01-01',
    });
    await setStatus(other, 'active');
    const moved = await h
      .as('admin')
      .patch(`/assignments/${partId}`, { publisherId: other });
    expect(moved.status).toBe(200);
    await svc.sync(tenantId, today());
    const [t] = await tasks();
    expect(t.status).toBe('done');
  });

  it('is not raised again for the same lapse, and is after a new one', async () => {
    const again = await h.as('admin').post('/assignments', {
      weekStartDate: monday(3),
      eventType: 'midweek',
      partKey: 'bible_reading',
      partOrder: 3,
      partTitle: 'Чтение Библии',
      partDurationMin: 4,
      status: 'draft',
    });
    await h.sql(`UPDATE assignments SET publisher_id = $1 WHERE id = $2`, [
      away,
      again.body.id,
    ]);
    expect(await svc.sync(tenantId, today())).toBe(0);
    // He serves again: the lapse is over and forgotten.
    await setStatus(away, 'irregular');
    await svc.sync(tenantId, today());
    expect(await tasks()).toEqual([]);
    // A new lapse with something still his: a new task.
    await setStatus(away, 'inactive');
    expect(await svc.sync(tenantId, today())).toBe(1);
  });
});
