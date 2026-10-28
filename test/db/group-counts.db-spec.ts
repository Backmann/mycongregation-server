import { Harness, startHarness } from './harness';

/**
 * How big each group is, in the groups' list (28 October 2026): a number for
 * everybody, the pioneers for those with private access — and the number
 * counts what that reader would be shown.
 */
describe('service groups: member and pioneer counts (real database)', () => {
  let h: Harness;
  let groupId: string;

  beforeAll(async () => {
    h = await startHarness();
    const g = await h.as('admin').post('/service-groups', { name: 'Остров' });
    expect(g.status).toBe(201);
    groupId = g.body.id;
    const add = async (body: Record<string, unknown>) => {
      const id = await h.addPublisher(body);
      await h.sql(`UPDATE publishers SET service_group_id = $1 WHERE id = $2`, [
        groupId,
        id,
      ]);
      return id;
    };
    const me = await add({
      firstName: 'Ян',
      lastName: 'Свой',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
    });
    await add({
      firstName: 'Ида',
      lastName: 'Пионер',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
      pioneerType: 'regular',
      pioneerSince: '2020-09-01',
    });
    await add({
      firstName: 'Ева',
      lastName: 'Будущая',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
      pioneerType: 'regular',
      pioneerSince: '2099-09-01',
    });
    await add({
      firstName: 'Лев',
      lastName: 'Учащийся',
      appointment: 'student',
    });
    const away = await add({
      firstName: 'Олег',
      lastName: 'Неактивный',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
    });
    // Fresh cards have no reports yet; their standing is set by hand here.
    await h.sql(
      `UPDATE publishers SET status = 'active', status_manually_overridden = true WHERE service_group_id = $1`,
      [groupId],
    );
    await h.sql(
      `UPDATE publishers SET status = 'inactive', status_manually_overridden = true WHERE id = $1`,
      [away],
    );
    await h.addUser({ login: 'svoy', role: 'publisher', publisherId: me });
    // A second member, made the group's assistant: he sees its inactive.
    const helper = await add({
      firstName: 'Пётр',
      lastName: 'Помощник',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
    });
    await h.sql(
      `UPDATE publishers SET status = 'active', status_manually_overridden = true WHERE id = $1`,
      [helper],
    );
    await h.sql(
      `UPDATE service_groups SET assistant_publisher_id = $1 WHERE id = $2`,
      [helper, groupId],
    );
    await h.addUser({
      login: 'pomosh',
      role: 'publisher',
      publisherId: helper,
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const row = async (who: string) => {
    const r = await h.as(who).get('/service-groups');
    expect(r.status).toBe(200);
    return (
      r.body.data as {
        id: string;
        memberCount?: number;
        pioneerCount?: number;
      }[]
    ).find((g) => g.id === groupId)!;
  };

  it('an elder sees everybody but the student, and the pioneers already serving', async () => {
    const g = await row('admin');
    expect(g.memberCount).toBe(5);
    expect(g.pioneerCount).toBe(1);
  });

  it('a publisher sees the size as the roster would show it, and no pioneers', async () => {
    const g = await row('svoy');
    expect(g.memberCount).toBe(4);
    expect(g).not.toHaveProperty('pioneerCount');
  });

  it("the group's assistant counts its inactive too, as his roster shows them", async () => {
    const g = await row('pomosh');
    expect(g.memberCount).toBe(5);
  });
});
