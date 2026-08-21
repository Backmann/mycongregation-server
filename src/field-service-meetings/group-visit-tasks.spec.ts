jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { GroupVisitTasksService } from './group-visit-tasks.service';

/**
 * The task that says «there are groups he has not been to this year».
 *
 * Everything awkward here lives on a seam between three sections. The visit is
 * a mark on a MEETING; the answer is computed by the SERVICE OVERSEER page; the
 * reminder is a TASK. Each is edited by different people at different times,
 * and the tests below are almost all about what happens when one of them
 * changes under the other two.
 */
describe('GroupVisitTasksService', () => {
  const build = (opts: {
    waiting?: number;
    existing?: Record<string, unknown> | null;
    offered?: boolean;
    timezone?: string;
  }) => {
    const saved: Record<string, unknown>[] = [];
    const updates: [string, Record<string, unknown>][] = [];
    const service = Object.create(
      GroupVisitTasksService.prototype,
    ) as GroupVisitTasksService;
    Object.assign(service, {
      congregations: {
        find: jest.fn(async () => [
          { id: 'c1', timezone: opts.timezone ?? 'Europe/Berlin' },
        ]),
      },
      tasks: {
        findOne: jest.fn(async () => opts.existing ?? null),
        create: (x: Record<string, unknown>) => x,
        save: jest.fn(async (x: Record<string, unknown>) => {
          saved.push(x);
          return x;
        }),
        update: jest.fn(async (id: string, patch: Record<string, unknown>) => {
          updates.push([id, patch]);
        }),
      },
      log: {
        findOne: jest.fn(async () => (opts.offered ? { id: 'l1' } : null)),
        create: (x: unknown) => x,
        save: jest.fn(),
      },
      responsibilities: { find: jest.fn(async () => [{ userId: 'u-so' }]) },
      publishers: { find: jest.fn(async () => [{ id: 'p-so' }]) },
      overseer: {
        groupsAtRisk: jest.fn(async () => ({
          serviceYear: 2026,
          waiting: Array.from({ length: opts.waiting ?? 0 }, (_, i) => ({
            serviceGroupId: `g${i}`,
          })),
          tooNew: 0,
        })),
      },
      logger: { log: jest.fn(), warn: jest.fn() },
    });
    return { service, saved, updates };
  };

  const may = new Date('2026-05-04T09:00:00Z');

  it('raises the task in May, when there is still time to arrange visits', async () => {
    const { service, saved } = build({ waiting: 2 });

    await service.ensureForToday(may);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      kind: 'service_overseer_visits',
      kindPeriod: '2026',
      dueDate: '2026-08-31',
      area: 'ministry',
    });
  });

  it('says nothing in the winter, when the year has months left in it', async () => {
    // A task open for eleven months is furniture, not a reminder.
    const { service, saved } = build({ waiting: 3 });

    await service.ensureForToday(new Date('2026-01-15T09:00:00Z'));

    expect(saved).toHaveLength(0);
  });

  it('assigns it to the service overseer by name', async () => {
    const { service, saved } = build({ waiting: 1 });

    await service.ensureForToday(may);

    expect(saved[0].assignees).toEqual([{ id: 'p-so' }]);
  });

  it('does not come back after somebody deleted it', async () => {
    // «Удаление есть решение» — the rule every calendar task obeys, and the
    // log is what remembers it, since a deleted task leaves nothing behind.
    const { service, saved } = build({ waiting: 2, offered: true });

    await service.ensureForToday(may);

    expect(saved).toHaveLength(0);
  });

  it('closes itself once every group is covered', async () => {
    // Asking a man to tick off a question that answered itself is asking him
    // to keep our books.
    const { service, updates } = build({
      waiting: 0,
      existing: { id: 't1', status: 'open', doneById: null },
    });

    await service.ensureForToday(may);

    expect(updates[0][0]).toBe('t1');
    expect(updates[0][1]).toMatchObject({ status: 'done', doneById: null });
  });

  it('re-opens itself when the visit that closed it disappears', async () => {
    // A meeting is deleted OUTRIGHT — no soft delete, no trace. So the visit
    // that covered a group can vanish, and a task closed on its strength would
    // assert something untrue for the rest of the year.
    const { service, updates } = build({
      waiting: 1,
      existing: { id: 't1', status: 'done', doneById: null },
    });

    await service.ensureForToday(may);

    expect(updates[0][1]).toMatchObject({ status: 'open', doneAt: null });
  });

  it('never re-opens what a PERSON closed', async () => {
    // He may know something the data does not — that he has agreed the dates
    // by telephone. Arguing with him would teach him to ignore the list.
    const { service, updates } = build({
      waiting: 1,
      existing: { id: 't1', status: 'done', doneById: 'u-elder' },
    });

    await service.ensureForToday(may);

    expect(updates).toHaveLength(0);
  });

  it('creates nothing twice — an open task is left alone', async () => {
    const { service, saved, updates } = build({
      waiting: 2,
      existing: { id: 't1', status: 'open', doneById: null },
    });

    await service.ensureForToday(may);

    expect(saved).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('counts the month in the congregation\u2019s own zone', async () => {
    // 30 April 22:30 UTC is already 1 May in Berlin. The pass must not use the
    // server's month — the same lesson the task reminders learned.
    const { service, saved } = build({ waiting: 1 });

    await service.ensureForToday(new Date('2026-04-30T22:30:00Z'));

    expect(saved).toHaveLength(1);
  });
});
