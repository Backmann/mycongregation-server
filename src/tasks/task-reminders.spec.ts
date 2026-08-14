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
      // The congregation, for the language the words are written in.
      {
        findOne: async () => ({ language: 'ru', timezone: 'Europe/Berlin' }),
      } as never,
      // Meetings — the day-before reminder looks here; none in these tests.
      { find: async () => [] } as never,
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

    // 17:30 in Berlin — an hour and a half before a seven o'clock meeting.
    await service.runDue(at('2026-08-12T15:30:00Z'));

    expect(notify.mock.calls[0][0]).toMatchObject({ key: 'task-soon:t2' });
  });

  it('counts the two hours on the congregation own clock', async () => {
    // «Two hours before seven» used to mean two hours before seven where the
    // SERVER stands — right for one congregation in Germany, wrong for the
    // next one anywhere else. The hour a brother was given is the hour on his
    // own wall.
    const notify = jest.fn(
      async (_input: Record<string, unknown>) => undefined,
    );
    const service = new TaskRemindersService(
      {
        find: async () => [
          {
            id: 't-tz',
            congregationId: 'c1',
            dueDate: '2026-08-12',
            dueTime: '19:00',
          },
        ],
      } as never,
      {
        findOne: async () => ({ language: 'ru', timezone: 'Asia/Tbilisi' }),
      } as never,
      { find: async () => [] } as never,
      { membersOf: async () => [{ id: 'p1', userId: 'u1' }] } as never,
      { notify } as never,
    );

    // 15:30 UTC is 17:30 in Berlin — but 19:30 in Tbilisi, where seven has
    // already passed. Nothing is sent.
    await service.runDue(at('2026-08-12T15:30:00Z'));
    expect(notify).not.toHaveBeenCalled();
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

  it('writes words, not the keys the code uses', async () => {
    // The first version passed «task_assigned» straight through, and that is
    // what arrived on the phone. A push is written with nobody looking at a
    // screen, so the words have to live here.
    const { service, notify } = build([
      {
        id: 't7',
        congregationId: 'c1',
        area: 'announcements',
        dueDate: '2026-08-13',
        dueTime: null,
      },
    ]);

    await service.runDue(at('2026-08-12T09:00:00Z'));

    const sent = notify.mock.calls[0][0] as { title: string; body: string };
    expect(sent.title).toBe('Задача на завтра');
    // The category travels — «a task is due» alone tells nobody what to do —
    // but the case itself does not.
    expect(sent.body).toContain('Объявления');
  });

  it('reminds the body the evening before its own meeting', async () => {
    // Lionel was right that this matters more than the notice of approval:
    // «the agenda is ready» is useful once, «the meeting is tomorrow» is
    // useful the evening before.
    const notify = jest.fn(
      async (_input: Record<string, unknown>) => undefined,
    );
    // In the order the service declares them: tasks, congregations, meetings,
    // addressees, notifications.
    const service = new TaskRemindersService(
      { find: async () => [] } as never,
      {
        findOne: async () => ({ language: 'ru', timezone: 'Europe/Berlin' }),
      } as never,
      {
        find: async () => [
          {
            id: 'm1',
            congregationId: 'c1',
            date: '2026-08-13',
            startTime: '19:00',
            placeText: 'Bunsenstr. 46',
          },
        ],
      } as never,
      {
        membersOf: async () => [],
        membersOfKind: async () => [{ id: 'p1', userId: 'u1' }],
      } as never,
      { notify } as never,
    );

    await service.runDue(at('2026-08-12T09:00:00Z'));

    const sent = notify.mock.calls[0][0] as { title: string; key: string };
    expect(sent.title).toBe('Завтра встреча совета старейшин');
    expect(sent.key).toBe('meeting-tomorrow:m1');
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
      {
        findOne: async () => ({ language: 'ru', timezone: 'Europe/Berlin' }),
      } as never,
      // Meetings — the day-before reminder looks here; none in these tests.
      { find: async () => [] } as never,
      { membersOf: async () => [{ id: 'p9', userId: null }] } as never,
      { notify } as never,
    );

    await service.runDue(at('2026-08-12T09:00:00Z'));

    expect(notify).not.toHaveBeenCalled();
  });
});
