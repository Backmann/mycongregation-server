jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { TasksService } from './tasks.service';

/**
 * Who closed this, and when.
 *
 * `done_at` and `done_by_id` have been filled since the module shipped and
 * never left the server. So a finished card had nothing to say about the work
 * and fell back to the only thing it knew — the deadline — announcing
 * «Просрочено на 8 дней» about a task that was done. True of the date,
 * useless about the deed, and faintly accusing.
 */
describe('TasksService.listTasks — the closer', () => {
  const build = (rows: unknown[], cards: unknown[]) => {
    const service = Object.create(TasksService.prototype) as TasksService;
    Object.assign(service, {
      tasks: { find: jest.fn().mockResolvedValue(rows) },
      publishers: { find: jest.fn().mockResolvedValue(cards) },
      addressees: { membersOfKind: jest.fn().mockResolvedValue([]) },
    });
    return service;
  };

  const done = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    congregationId: 'c1',
    status: 'done',
    doneById: 'u1',
    doneAt: new Date('2026-08-12T17:40:00Z'),
    assigneeKind: 'people',
    assignees: [],
    ...over,
  });

  it('names the person from their publisher card', async () => {
    const service = build(
      [done()],
      [{ userId: 'u1', firstName: 'Лионель', lastName: 'Бакманн' }],
    );

    const [task] = await service.listTasks('c1');

    expect((task as { doneByName?: string }).doneByName).toBe(
      'Бакманн Лионель',
    );
    // And the moment itself still travels — the screen shows both.
    expect(task.doneAt).toEqual(new Date('2026-08-12T17:40:00Z'));
  });

  it('leaves the name null when the account has no card', async () => {
    // An administrator who is not a publisher here has none. Better an honest
    // null the screen can handle than a guessed name.
    const service = build([done()], []);

    const [task] = await service.listTasks('c1');

    expect((task as { doneByName?: string | null }).doneByName).toBeNull();
  });

  it('says nothing about a task nobody has closed', async () => {
    const service = build(
      [done({ status: 'open', doneById: null, doneAt: null })],
      [{ userId: 'u1', firstName: 'Лионель', lastName: 'Бакманн' }],
    );

    const [task] = await service.listTasks('c1');

    expect((task as { doneByName?: string | null }).doneByName).toBeNull();
  });

  it('asks the database once for a page full of closed tasks', async () => {
    // One lookup for the page, not one per card — the same reasoning as the
    // committee membership just above it.
    const service = build(
      [done({ id: 'a' }), done({ id: 'b', doneById: 'u2' }), done({ id: 'c' })],
      [
        { userId: 'u1', firstName: 'Лионель', lastName: 'Бакманн' },
        { userId: 'u2', firstName: 'Вера', lastName: 'Сидорова' },
      ],
    );

    const tasks = await service.listTasks('c1');

    expect(
      (service as unknown as { publishers: { find: jest.Mock } }).publishers
        .find,
    ).toHaveBeenCalledTimes(1);
    expect(
      tasks.map((t) => (t as { doneByName?: string | null }).doneByName),
    ).toEqual(['Бакманн Лионель', 'Сидорова Вера', 'Бакманн Лионель']);
  });
});
