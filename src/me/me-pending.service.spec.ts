import { MePendingService } from './me-pending.service';

// The reports service reaches expo-server-sdk through the publishers
// service; it is ESM-only and Jest does not transform it. Nothing here needs
// the real one — every call is stubbed — so cut the chain at the import.
jest.mock('../service-reports/service-reports.service', () => ({
  ServiceReportsService: class ServiceReportsServiceMock {},
}));

// Same chain, other end: tasks reach it through their reminders.
jest.mock('../tasks/tasks.service', () => ({
  TasksService: class TasksServiceMock {},
}));

/**
 * The rules, pinned. What is NOT here matters as much as what is: a task due
 * next February, a person with no contacts at all, an account with no card.
 */

const USER = { id: 'u1', congregationId: 'c1' } as never;

function build(opts: {
  publisher?: Record<string, unknown> | null;
  standing?: Record<string, unknown>;
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
  const reports = {
    myReportStanding: () =>
      Promise.resolve({
        applicable: true,
        submitted: true,
        closesOn: '2026-09-19',
        ...(opts.standing ?? {}),
      }),
  };
  const tasks = { myTasks: () => Promise.resolve(opts.tasks ?? []) };
  const clock = { timezoneOf: () => Promise.resolve('Europe/Berlin') };

  return new MePendingService(
    publishersRepo as never,
    reports as never,
    tasks as never,
    clock as never,
  );
}

// The clock is asked for the congregation's today; freeze the real one so the
// spec does not start failing on its own in a week.
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

  it('asks for the report while it applies and is not in', async () => {
    const s = build({ standing: { submitted: false, closesOn: '2026-09-25' } });
    const { items } = await s.pending('c1', USER);
    expect(items).toEqual([
      { kind: 'report', dueOn: '2026-09-25', overdue: false },
    ]);
  });

  it('marks a report whose day has passed as overdue', async () => {
    const s = build({ standing: { submitted: false, closesOn: '2026-09-19' } });
    const { items } = await s.pending('c1', USER);
    expect(items[0].overdue).toBe(true);
  });

  it('says nothing about a report already handed in', async () => {
    const s = build({ standing: { submitted: true } });
    const { items } = await s.pending('c1', USER);
    expect(items).toEqual([]);
  });

  it('takes a task due within the week and leaves one due next year', async () => {
    const s = build({
      tasks: [
        { id: 't1', dueDate: '2026-09-21' },
        { id: 't2', dueDate: '2027-02-28' },
      ],
    });
    const { items } = await s.pending('c1', USER);
    expect(items.map((i) => i.id)).toEqual(['t1']);
  });

  it('leaves out a task with no deadline — it is work, not something waiting', async () => {
    const s = build({ tasks: [{ id: 't1', dueDate: null }] });
    const { items } = await s.pending('c1', USER);
    expect(items).toEqual([]);
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
      standing: { submitted: false, closesOn: '2026-09-25' },
      publisher: { contactsConfirmedAt: new Date('2020-01-01T00:00:00Z') },
      tasks: [
        { id: 'soon', dueDate: '2026-09-22' },
        { id: 'late', dueDate: '2026-09-10' },
      ],
    });
    const { items } = await s.pending('c1', USER);
    expect(items.map((i) => i.id ?? i.kind)).toEqual([
      'late',
      'soon',
      'report',
      'contacts',
    ]);
  });

  it('stops at five and says how many are left', async () => {
    const s = build({
      tasks: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        id: `t${n}`,
        dueDate: '2026-09-21',
      })),
    });
    const { items, more } = await s.pending('c1', USER);
    expect(items).toHaveLength(5);
    expect(more).toBe(2);
  });

  it('carries no words at all — only kinds and dates', async () => {
    const s = build({
      standing: { submitted: false, closesOn: '2026-09-25' },
      tasks: [{ id: 't1', dueDate: '2026-09-21', title: 'Проверить счета' }],
    });
    const { items } = await s.pending('c1', USER);
    const text = JSON.stringify(items);
    expect(text).not.toContain('Проверить');
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        item.id
          ? ['dueOn', 'id', 'kind', 'overdue']
          : ['dueOn', 'kind', 'overdue'],
      );
    }
  });
});
