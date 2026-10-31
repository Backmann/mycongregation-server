import { Harness, startHarness } from './harness';

/**
 * «Мои задачи» name the other brothers on a task and say nothing else about
 * them (31 October 2026). Before, whole cards went out — birth and baptism
 * dates, phone, address — to anyone on the task, a ministerial servant too.
 */
describe('my tasks show people by name only (real database)', () => {
  let h: Harness;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await startHarness();
    ids.servant = await h.addPublisher({
      firstName: 'servant',
      lastName: 'Тест',
      baptismDate: '2001-01-01',
      appointment: 'ministerial_servant',
    });
    await h.addUser({
      login: 'servant',
      role: 'ministerial_servant',
      publisherId: ids.servant,
    });
    ids.elder = await h.addPublisher({
      firstName: 'elder',
      lastName: 'Тест',
      baptismDate: '1990-05-05',
      birthDate: '1970-03-03',
      mobilePhone: '+49 151 0000000',
      appointment: 'elder',
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('the servant sees the elder on his task as id and name, nothing more', async () => {
    const made = await h.as('admin').post('/tasks', {
      title: 'Проверка счетов',
      area: 'accounts',
      assigneeKind: 'people',
      assigneePublisherIds: [ids.servant, ids.elder],
    });
    expect([200, 201]).toContain(made.status);

    const res = await h.as('servant').get('/me/tasks');
    expect(res.status).toBe(200);
    const task = (
      res.body as {
        title: string;
        members: Record<string, unknown>[];
        assignees: Record<string, unknown>[];
      }[]
    ).find((t) => t.title === 'Проверка счетов');
    expect(task).toBeDefined();
    for (const person of [...task!.members, ...task!.assignees]) {
      expect(Object.keys(person).sort()).toEqual([
        'firstName',
        'id',
        'lastName',
      ]);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/1970-03-03|0000000/);
  });
});
