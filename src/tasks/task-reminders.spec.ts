jest.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken() {
      return true;
    }
  },
}));

import { TaskRemindersService } from './task-reminders.service';

const at = (iso: string) => new Date(iso);

/**
 * Four moments, each guarded by a key — so a pass every fifteen minutes sends
 * nothing twice, and the overdue one repeats daily rather than hourly.
 */
describe('TaskRemindersService.runDue', () => {
  const build = (tasks: unknown[]) => {
    // Typed loosely on purpose: the point of each test is the KEY that was
    // sent, and a precise argument type here buys nothing and costs clarity.
    const notify = jest.fn(
      async (_input: Record<string, unknown>) => undefined,
    );
    const service = new TaskRemindersService(
      { find: async () => tasks } as never,
      { membersOf: async () => [{ id: 'p1', userId: 'u1' }] } as never,
      { notify } as never,
    );
    return { service, notify };
  };

  it('warns the day before', async () => {
    const { service, notify } = build([
      { id: 't1', congregationId: 'c1', dueDate: '2026-08-13', dueTime: null },
    ]);

    await service.runDue(at('2026-08-12T09:00:00Z'));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      kind: 'task',
      key: 'task-tomorrow:t1',
    });
  });

  it('warns two hours before an hour that was set', async () => {
    const { service, notify } = build([
      {
        id: 't2',
        congregationId: 'c1',
        dueDate: '2026-08-12',
        dueTime: '19:00',
      },
    ]);

    await service.runDue(at('2026-08-12T17:30:00'));

    expect(notify.mock.calls[0][0]).toMatchObject({ key: 'task-soon:t2' });
  });

  it('says nothing at breakfast about an evening meeting', async () => {
    // A reminder given six hours early is forgotten by the evening, which is
    // the failure the whole idea exists to prevent.
    const { service, notify } = build([
      {
        id: 't3',
        congregationId: 'c1',
        dueDate: '2026-08-12',
        dueTime: '19:00',
      },
    ]);

    await service.runDue(at('2026-08-12T08:00:00'));

    expect(notify).not.toHaveBeenCalled();
  });

  it('reminds about a late task once a DAY, not once a pass', async () => {
    const { service, notify } = build([
      { id: 't4', congregationId: 'c1', dueDate: '2026-08-01', dueTime: null },
    ]);

    await service.runDue(at('2026-08-12T09:00:00Z'));

    // The date in the key is what makes it daily.
    expect(notify.mock.calls[0][0]).toMatchObject({
      key: 'task-overdue:t4:2026-08-12',
    });
  });

  it('carries no task text, only that one is due', async () => {
    // A push shows on a locked screen the family can see, and «care in special
    // circumstances» is the most private material in this app.
    const { service, notify } = build([
      {
        id: 't5',
        congregationId: 'c1',
        title: 'Забота о брате',
        details: 'подробности',
        dueDate: '2026-08-13',
        dueTime: null,
      },
    ]);

    await service.runDue(at('2026-08-12T09:00:00Z'));

    const sent = JSON.stringify(notify.mock.calls[0][0]);
    expect(sent).not.toContain('Забота');
    expect(sent).not.toContain('подробности');
  });

  it('says nothing when nobody it reaches has a login', async () => {
    const notify = jest.fn(
      async (_input: Record<string, unknown>) => undefined,
    );
    const service = new TaskRemindersService(
      {
        find: async () => [
          { id: 't6', congregationId: 'c1', dueDate: '2026-08-13' },
        ],
      } as never,
      { membersOf: async () => [{ id: 'p9', userId: null }] } as never,
      { notify } as never,
    );

    await service.runDue(at('2026-08-12T09:00:00Z'));

    expect(notify).not.toHaveBeenCalled();
  });
});
