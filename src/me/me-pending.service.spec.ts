import { MePendingService } from './me-pending.service';

// Tasks reach expo-server-sdk through their reminders; it is ESM-only and Jest
// does not transform it. Every call here is stubbed, so cut the chain at the
// import.
jest.mock('../tasks/tasks.service', () => ({
  TasksService: class TasksServiceMock {},
}));

/**
 * The rules, pinned. What is NOT here matters as much as what is: a task due
 * next February, a person with no contacts at all, an account with no card —
 * and the report, which has a card of its own on the home screen.
 */

const USER = { id: 'u1', congregationId: 'c1' } as never;

function build(opts: {
  publisher?: Record<string, unknown> | null;
  tasks?: Record<string, unknown>[];
}) {
  const publishersRepo = {
    findOne: () =>
      Promise.resolve(
        opts.publisher === null
          ? null
          : {
              id: 'p1',
              mobilePhone: '+49 1512 000001',
              email: null,
              address: null,
              contactsConfirmedAt: new Date('2026-07-19T00:00:00Z'),
              createdAt: new Date('2024-01-01T00:00:00Z'),
              ...(opts.publisher ?? {}),
            },
      ),
  };
  const tasks = { myTasks: () => Promise.resolve(opts.tasks ?? []) };
  const clock = { timezoneOf: () => Promise.resolve('Europe/Berlin') };

  return new MePendingService(
    publishersRepo as never,
    tasks as never,
    clock as never,
  );
}

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-20T09:00:00Z'));
});
afterAll(() => {
  jest.useRealTimers();
});

describe('MePendingService', () => {
  it('says nothing is waiting for an account with no card of its own', async () => {
    const s = build({ publisher: null });
    await expect(s.pending('c1', USER)).resolves.toEqual({
      items: [],
      more: 0,
    });
  });

  it('takes a task due within the week and leaves one due next year', async () => {
    const s = build({
      tasks: [
        { id: 't1', title: 'Обзор пионеров', dueDate: '2026-09-21' },
        { id: 't2', title: 'Годовой отчёт', dueDate: '2027-02-28' },
      ],
    });
    const { items } = await s.pending('c1', USER);
    expect(items.map((i) => i.id)).toEqual(['t1']);
  });

  it('leaves out a task with no deadline — it is work, not something waiting', async () => {
    const s = build({ tasks: [{ id: 't1', title: 'x', dueDate: null }] });
    expect((await s.pending('c1', USER)).items).toEqual([]);
  });

  it('marks a task whose day has passed as overdue', async () => {
    const s = build({
      tasks: [{ id: 't1', title: 'x', dueDate: '2026-09-10' }],
    });
    expect((await s.pending('c1', USER)).items[0].overdue).toBe(true);
  });

  it('asks about contacts only once they are more than a year old', async () => {
    const fresh = build({
      publisher: { contactsConfirmedAt: new Date('2026-07-19T00:00:00Z') },
    });
    expect((await fresh.pending('c1', USER)).items).toEqual([]);

    const stale = build({
      publisher: { contactsConfirmedAt: new Date('2025-01-01T00:00:00Z') },
    });
    expect((await stale.pending('c1', USER)).items).toEqual([
      { kind: 'contacts', dueOn: null, overdue: false },
    ]);
  });

  it('never asks somebody who has no contacts at all', async () => {
    // An empty contact may be a deliberate choice; it must not become a
    // standing reproach.
    const s = build({
      publisher: {
        mobilePhone: null,
        email: null,
        address: null,
        contactsConfirmedAt: null,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
    expect((await s.pending('c1', USER)).items).toEqual([]);
  });

  it('puts the overdue first, then the nearest deadline, then the undated', async () => {
    const s = build({
      publisher: { contactsConfirmedAt: new Date('2020-01-01T00:00:00Z') },
      tasks: [
        { id: 'soon', title: 'a', dueDate: '2026-09-22' },
        { id: 'late', title: 'b', dueDate: '2026-09-10' },
      ],
    });
    const { items } = await s.pending('c1', USER);
    expect(items.map((i) => i.id ?? i.kind)).toEqual([
      'late',
      'soon',
      'contacts',
    ]);
  });

  it('stops at five and says how many are left', async () => {
    const s = build({
      tasks: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        id: `t${n}`,
        title: `Задача ${n}`,
        dueDate: '2026-09-21',
      })),
    });
    const { items, more } = await s.pending('c1', USER);
    expect(items).toHaveLength(5);
    expect(more).toBe(2);
  });

  it("keeps a task's title — what a brother typed, not screen text", async () => {
    // A row that only said «a task, due on the 20th» would not tell anybody
    // which one. The title is data; there is nothing to translate.
    const s = build({
      tasks: [{ id: 't1', title: 'Проверить счета', dueDate: '2026-09-21' }],
    });
    expect((await s.pending('c1', USER)).items[0].title).toBe(
      'Проверить счета',
    );
  });

  it('carries no screen text of its own — the contacts row is a kind, not a sentence', async () => {
    const s = build({
      publisher: { contactsConfirmedAt: new Date('2020-01-01T00:00:00Z') },
    });
    const [row] = (await s.pending('c1', USER)).items;
    expect(Object.keys(row).sort()).toEqual(['dueOn', 'kind', 'overdue']);
  });

  it('does not mention the report — it has a card of its own', async () => {
    const s = build({});
    const { items } = await s.pending('c1', USER);
    expect(items.some((i) => (i.kind as string) === 'report')).toBe(false);
  });
});
