import { Harness, startHarness } from './harness';

/**
 * Deaf, blind, in prison — for elders and admins only, on every route
 * (31 October 2026). A trusted member with canViewPrivateData already lost
 * them on GET /publishers/:id; the list, the service groups and a group's
 * members still carried them for the whole congregation.
 */
describe('elders-only fields stay with elders (real database)', () => {
  let h: Harness;
  let groupId: string;

  beforeAll(async () => {
    h = await startHarness();
    const group = await h.as('admin').post('/service-groups', {
      name: 'Группа проверки',
    });
    expect(group.status).toBe(201);
    groupId = group.body.id as string;
    const deaf = await h.addPublisher({
      firstName: 'deaf',
      lastName: 'Тест',
      isDeaf: true,
      serviceGroupId: groupId,
    });
    await h.as('admin').patch(`/service-groups/${groupId}`, {
      overseerPublisherId: deaf,
    });
    const trusted = await h.addPublisher({
      firstName: 'trusted',
      lastName: 'Тест',
      appointment: 'ministerial_servant',
      baptismDate: '2001-01-01',
    });
    const userId = await h.addUser({
      login: 'trusted',
      role: 'ministerial_servant',
      publisherId: trusted,
    });
    await h.sql(`UPDATE users SET can_view_private_data = true WHERE id = $1`, [
      userId,
    ]);
  });
  afterAll(async () => {
    await h?.close();
  });

  const flags = /"is(Deaf|Blind|Imprisoned)"/;

  it('the trusted member gets cards without the three flags', async () => {
    for (const path of [
      '/publishers?limit=200',
      '/service-groups',
      `/service-groups/${groupId}`,
      `/service-groups/${groupId}/publishers`,
    ]) {
      const res = await h.as('trusted').get(path);
      expect([path, res.status]).toEqual([path, 200]);
      expect([path, flags.test(JSON.stringify(res.body))]).toEqual([
        path,
        false,
      ]);
    }
  });

  it('an elder still sees them', async () => {
    const res = await h.as('admin').get('/publishers?limit=200');
    expect(JSON.stringify(res.body)).toMatch(/"isDeaf":true/);
  });

  it('the trusted member still gets the private fields he is meant to have', async () => {
    const res = await h.as('trusted').get('/publishers?limit=200');
    expect(JSON.stringify(res.body)).toMatch(/"baptismDate"/);
  });
});
