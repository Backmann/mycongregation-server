import { Harness, startHarness } from './harness';
import { AdminNotElderService } from '../../src/tasks/admin-not-elder.service';
import { periodOf } from '../../src/tasks/inactive-holds.service';

/**
 * Only an elder is an administrator (1 November 2026), against a real
 * database: the role is refused to anyone else, and a brother who stops
 * being an elder while he holds it is the elders' task — raised, named for
 * them, and lowered when it is settled.
 */
describe('an administrator is an elder (real database)', () => {
  let h: Harness;
  let tenantId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await startHarness();
    ids.ms = await h.addPublisher({
      firstName: 'Помощник',
      lastName: 'Тест',
      appointment: 'ministerial_servant',
      baptismDate: '2000-01-01',
    });
    ids.msUser = await h.addUser({
      login: 'msuser',
      role: 'ministerial_servant',
      publisherId: ids.ms,
    });
    ids.elder = await h.addPublisher({
      firstName: 'Старейшина',
      lastName: 'Тест',
      appointment: 'elder',
      baptismDate: '1990-01-01',
    });
    ids.elderUser = await h.addUser({
      login: 'eldr',
      role: 'elder',
      publisherId: ids.elder,
    });
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM publishers WHERE id = $1`,
      [ids.elder],
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('refuses the role to a ministerial servant, gives it to an elder', async () => {
    const no = await h
      .as('admin')
      .patch(`/users/${ids.msUser}/role`, { role: 'admin' });
    expect([no.status, no.body.code]).toEqual([403, 'ADMIN_ELDERS_ONLY']);
    const yes = await h
      .as('admin')
      .patch(`/users/${ids.elderUser}/role`, { role: 'admin' });
    expect(yes.status).toBe(200);
  });

  it('an administrator who stops being an elder is the elders’ task, until settled', async () => {
    const svc = h.app.get(AdminNotElderService);
    const period = periodOf(ids.elderUser);
    const mine = () =>
      h.sql<{ id: string; status: string }>(
        `SELECT id, status FROM elder_tasks WHERE congregation_id = $1 AND kind = 'admin_not_elder' AND kind_period = $2`,
        [tenantId, period],
      );
    await svc.sync(tenantId);
    expect(await mine()).toEqual([]);

    await h.sql(
      `UPDATE publishers SET appointment = 'ministerial_servant' WHERE id = $1`,
      [ids.elder],
    );
    await svc.sync(tenantId);
    const [t] = await mine();
    expect(t.status).toBe('open');
    const named = await h.as('admin').get(`/tasks/${t.id}/admin-not-elder`);
    expect(named.status).toBe(200);
    expect(named.body.name).toMatch(/Старейшина/);

    await h.sql(`UPDATE publishers SET appointment = 'elder' WHERE id = $1`, [
      ids.elder,
    ]);
    await svc.sync(tenantId);
    expect(await mine()).toEqual([]);
  });

  it('giving a card access as an administrator: only an elder’s card', async () => {
    const card = await h.addPublisher({
      firstName: 'Ещёпомощник',
      lastName: 'Тест',
      appointment: 'ministerial_servant',
      baptismDate: '2000-01-01',
    });
    const no = await h.as('admin').post(`/publishers/${card}/access`, {
      loginName: 'eshche.pomoshnik',
      password: 'Stand-12345!',
      isAdmin: true,
    });
    expect([no.status, no.body.code]).toEqual([403, 'ADMIN_ELDERS_ONLY']);
    const elderCard = await h.addPublisher({
      firstName: 'Ещёстарейшина',
      lastName: 'Тест',
      appointment: 'elder',
      baptismDate: '1990-01-01',
    });
    const yes = await h.as('admin').post(`/publishers/${elderCard}/access`, {
      loginName: 'eshche.starejshina',
      password: 'Stand-12345!',
      isAdmin: true,
    });
    expect([200, 201]).toContain(yes.status);
  });
});
