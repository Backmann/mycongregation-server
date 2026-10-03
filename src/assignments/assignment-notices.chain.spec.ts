jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { AssignmentsService } from './assignments.service';
import { AssignmentRemindersService } from '../assignment-reminders/assignment-reminders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { memRepo } from '../common/testing/mem-repo';
import { clockStub } from '../common/testing/clock-stub';

/**
 * FROM A PRESS OF «СООБЩИТЬ» TO WHAT LANDS ON A PERSON'S DEVICE.
 *
 * Three real services in a row — the schedule, the record of what each person
 * was told, and the notification gateway with its real dedupe keys, quiet
 * hours and switches — over tables held in memory. Only the two ends are
 * stand-ins: the tables, and the push transport, which simply records what it
 * was handed.
 *
 * It exists because of 3 October 2026: «тестовое уведомление приходит, а о
 * назначении — нет». Each service was right by its own tests. The fault was
 * between them: the schedule keyed its message by the DAY, the gateway read
 * the second message of that day as a repeat and dropped it, and nothing was
 * written anywhere to say so.
 */

const C = 'cong-1';
const WEEK = '2026-10-12'; // Monday
const SUNDAY = '2026-10-18';

type Push = { userId: string; title: string; body: string };

function world(
  over: { devices?: Record<string, 'phone' | 'web' | 'no_device'> } = {},
) {
  const publishers = memRepo<any>([
    {
      id: 'p-a',
      congregationId: C,
      userId: 'u-a',
      displayName: 'А',
      firstName: 'Андрей',
    },
    {
      id: 'p-b',
      congregationId: C,
      userId: 'u-b',
      displayName: 'Б',
      firstName: 'Борис',
    },
    {
      id: 'p-c',
      congregationId: C,
      userId: 'u-c',
      displayName: 'В',
      firstName: 'Виктор',
    },
    {
      id: 'p-x',
      congregationId: C,
      userId: null,
      displayName: 'Без входа',
      firstName: 'Х',
    },
  ]);
  const users = memRepo<any>(
    ['a', 'b', 'c'].map((x) => ({
      id: `u-${x}`,
      congregationId: C,
      uiLanguage: 'ru',
      isActive: true,
      email: `${x}@example.invalid`,
      reminderLadder: null,
    })),
  );
  const part = (
    id: string,
    partKey: string,
    publisherId: string | null,
    order: number,
  ) => ({
    id,
    congregationId: C,
    weekStartDate: WEEK,
    eventType: 'weekend',
    partKey,
    partTitle: null,
    partOrder: order,
    publisherId,
    assistantPublisherId: null,
    status: 'published',
    changedSincePublish: false,
    deletedAt: null,
  });
  const assignments = memRepo<any>(
    [
      part('chair', 'weekend_chairman', null, 1),
      part('reader', 'watchtower_reader', 'p-b', 2),
      part('prayer', 'weekend_closing_prayer', 'p-c', 3),
    ],
    { manager: users },
  );
  const notices = memRepo<any>([]);
  const outbox = memRepo<any>([], {
    unique: ['congregationId', 'userId', 'dedupeKey'],
  });
  const preferences = memRepo<any>([]);

  const pushes: Push[] = [];
  const letters: Push[] = [];
  const push = {
    sendToUsers: jest.fn(
      async (_t: string, ids: string[], title: string, body: string) => {
        const reach = new Map<string, string>();
        for (const id of ids) {
          const where = over.devices?.[id] ?? 'phone';
          reach.set(id, where);
          if (where !== 'no_device') pushes.push({ userId: id, title, body });
        }
        return reach;
      },
    ),
  };
  const mail = {
    sendNotice: jest.fn(async (to: string, _l: string, n: any) => {
      letters.push({ userId: to, title: n.title, body: n.body });
      return true;
    }),
  };

  const notifications = new NotificationsService(
    outbox as any,
    preferences as any,
    push as any,
    clockStub('Europe/Berlin'),
    users as any,
    publishers as any,
    mail as any,
  );
  const weekRules = {
    forWeek: async () => ({ meetings: [{ kind: 'weekend', date: SUNDAY }] }),
    forWeeks: async (_c: string, weeks: string[]) =>
      new Map(
        weeks.map((w) => [
          w,
          { meetings: w === WEEK ? [{ kind: 'weekend', date: SUNDAY }] : [] },
        ]),
      ),
  };
  const reminders = new AssignmentRemindersService(
    assignments as any,
    memRepo<any>([]) as any, // duties
    publishers as any,
    users as any,
    notices as any,
    memRepo<any>([{ id: C, timezone: 'Europe/Berlin', language: 'ru' }]) as any,
    memRepo<any>([]) as any, // absences
    memRepo<any>([]) as any, // responsibilities
    memRepo<any>([]) as any, // push tokens
    memRepo<any>([]) as any, // browser subscriptions
    weekRules as any,
    { forRange: async () => [] } as any,
    notifications,
    memRepo<any>([]) as any, // field-service meetings
    memRepo<any>([]) as any, // cleaning weeks
    memRepo<any>([]) as any, // talk exchange
    memRepo<any>([]) as any, // host congregations
  );
  const service = new AssignmentsService(
    assignments as any,
    memRepo<any>([]) as any,
    publishers as any,
    memRepo<any>([]) as any,
    memRepo<any>([]) as any,
    {} as any,
    notifications,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    clockStub('Europe/Berlin'),
    {} as any,
    reminders,
  );

  /** The notices are fire-and-forget; let them finish. */
  const settle = async () => {
    for (let i = 0; i < 400; i++) await Promise.resolve();
  };
  const row = (id: string) => assignments.rows.find((r) => r.id === id);
  /** What AssignmentsService.update does to a published part. */
  const assign = (id: string, publisherId: string | null) => {
    Object.assign(row(id), { publisherId, changedSincePublish: true });
  };
  const tellNow = async () => {
    await service.notifyChanges(C, WEEK, 'weekend' as never);
    await settle();
  };
  /** «Не сейчас»: the silent re-publish the window issues. */
  const notNow = async () => {
    await service.publishMeeting(C, WEEK, 'weekend' as never, false);
    await settle();
  };
  const at = (iso: string) => jest.setSystemTime(new Date(iso));
  const later = (ms: number) => jest.setSystemTime(Date.now() + ms);
  const to = (userId: string) => pushes.filter((p) => p.userId === userId);

  return {
    service,
    reminders,
    notifications,
    assignments,
    notices,
    outbox,
    preferences,
    pushes,
    letters,
    row,
    assign,
    tellNow,
    notNow,
    settle,
    at,
    later,
    to,
  };
}

beforeEach(() => {
  // A Saturday morning in Berlin, well inside the waking hours.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-10-03T08:00:00Z'));
});
afterEach(() => jest.useRealTimers());

describe('one day, one meeting, several edits', () => {
  // The fault itself. Before the fix the third, fourth and fifth were dropped.
  it('every press is heard: assign, take away, assign again, and again', async () => {
    const w = world();

    w.assign('chair', 'p-a');
    await w.tellNow();
    w.later(60_000);
    w.assign('chair', null);
    await w.tellNow();
    w.later(60_000);
    w.assign('chair', 'p-a');
    await w.tellNow();
    w.later(60_000);
    w.assign('chair', null);
    await w.tellNow();
    w.later(60_000);
    w.assign('chair', 'p-a');
    await w.tellNow();

    expect(w.to('u-a').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Назначение отменено',
      'Вам назначено',
      'Назначение отменено',
      'Вам назначено',
    ]);
  });

  it('two different parts on one day are two messages', async () => {
    const w = world();

    w.assign('chair', 'p-a');
    await w.tellNow();
    w.later(5 * 60_000);
    w.assign('prayer', 'p-a');
    await w.tellNow();

    const mine = w.to('u-a');
    expect(mine).toHaveLength(2);
    expect(mine[0].body).toContain('Председатель встречи');
    expect(mine[1].body).toContain('Заключительная молитва');
  });

  // A press clears what it announced, so a second tap has nothing to say.
  it('a double tap is still one message', async () => {
    const w = world();

    w.assign('chair', 'p-a');
    await w.tellNow();
    await w.tellNow();

    expect(w.to('u-a')).toHaveLength(1);
  });
});

describe('who a press concerns', () => {
  it('a part given to somebody tells that person and nobody else', async () => {
    const w = world();

    w.assign('chair', 'p-a');
    await w.tellNow();

    expect(w.pushes.map((p) => p.userId)).toEqual(['u-a']);
  });

  it('replacing a person tells the new one and the one replaced', async () => {
    const w = world();
    // Виктор was told of the prayer earlier.
    w.assign('prayer', 'p-c');
    await w.tellNow();
    w.later(60_000);

    w.assign('prayer', 'p-a');
    await w.tellNow();

    expect(w.to('u-a').map((p) => p.title)).toEqual(['Вам назначено']);
    expect(w.to('u-c').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Назначение отменено',
    ]);
  });

  // Somebody who was never told has nothing to be taken back from.
  it('says nothing of a removal to a person who never heard of the part', async () => {
    const w = world();

    w.assign('prayer', 'p-a'); // Виктор held it, unannounced
    await w.tellNow();

    expect(w.to('u-c')).toEqual([]);
  });

  it('a new partner is news to the partner and a change to the one who knew', async () => {
    const w = world();
    w.assign('reader', 'p-b');
    await w.tellNow();
    w.later(60_000);

    Object.assign(w.row('reader'), {
      assistantPublisherId: 'p-a',
      changedSincePublish: true,
    });
    await w.tellNow();

    expect(w.to('u-a').map((p) => p.title)).toEqual(['Вам назначено']);
    expect(w.to('u-b').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Ваше назначение изменилось',
    ]);
  });

  it('a part given to somebody without a login tells nobody, and breaks nothing', async () => {
    const w = world();

    w.assign('chair', 'p-x');
    await w.tellNow();

    expect(w.pushes).toEqual([]);
  });
});

describe('publishing', () => {
  // Adding one part to a week that is already out used to re-announce the
  // whole meeting — or nobody, once each had been told.
  it('a part added to a published meeting tells only its own assignee', async () => {
    const w = world();
    w.assignments.rows.push({
      id: 'talk',
      congregationId: C,
      weekStartDate: WEEK,
      eventType: 'weekend',
      partKey: 'public_talk_speaker',
      partTitle: null,
      partOrder: 0,
      publisherId: 'p-a',
      assistantPublisherId: null,
      status: 'draft',
      changedSincePublish: false,
      deletedAt: null,
    });

    await w.service.publishMeeting(C, WEEK, 'weekend' as never, true);
    await w.settle();

    expect(w.pushes.map((p) => p.userId)).toEqual(['u-a']);
    expect(w.row('talk').status).toBe('published');
  });

  it('the first publication of a meeting tells everybody on it, once', async () => {
    const w = world();
    for (const r of w.assignments.rows) r.status = 'draft';

    await w.service.publishMeeting(C, WEEK, 'weekend' as never, true);
    await w.settle();
    w.later(60_000);
    await w.service.publishMeeting(C, WEEK, 'weekend' as never, true);
    await w.settle();

    expect(w.pushes.map((p) => p.userId).sort()).toEqual(['u-b', 'u-c']);
    expect(w.pushes.every((p) => p.title === 'Вам назначено')).toBe(true);
  });

  it('publishing with «уведомить» also announces the edits it covers', async () => {
    const w = world();
    w.assign('chair', 'p-a');

    await w.service.publishMeeting(C, WEEK, 'weekend' as never, true);
    await w.settle();

    expect(w.to('u-a').map((p) => p.title)).toEqual(['Вам назначено']);
  });
});

describe('«не сейчас»', () => {
  it('sends nothing now', async () => {
    const w = world();

    w.assign('chair', 'p-a');
    await w.notNow();

    expect(w.pushes).toEqual([]);
    expect(w.row('chair').changedSincePublish).toBe(false);
  });

  // Silent now is not silent for ever: the ladder says it on its next step,
  // and says it as an assignment.
  it('is said by the evening ladder, as an assignment, on the next step', async () => {
    const w = world();
    w.assign('chair', 'p-a');
    await w.notNow();

    await w.reminders.sendDigests(C, '2026-10-03'); // 15 days: no step
    expect(w.to('u-a')).toEqual([]);

    await w.reminders.sendDigests(C, '2026-10-04'); // 14 days
    expect(w.to('u-a').map((p) => p.title)).toEqual(['Вам назначено']);
  });

  it('a person silently replaced hears it the same evening', async () => {
    const w = world();
    w.assign('prayer', 'p-c');
    await w.tellNow();
    w.later(60_000);

    w.assign('prayer', 'p-a');
    await w.notNow();
    expect(w.to('u-c')).toHaveLength(1);

    await w.reminders.sendDigests(C, '2026-10-03');
    expect(w.to('u-c').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Назначение отменено',
    ]);
  });
});

describe('after «сообщить сейчас»', () => {
  it('the ladder recalls the part instead of announcing it again', async () => {
    const w = world();
    w.assign('chair', 'p-a');
    await w.tellNow();

    await w.reminders.sendDigests(C, '2026-10-04');

    expect(w.to('u-a').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Ваши ближайшие задания',
    ]);
  });

  it('the evening before reads «Завтра у вас»', async () => {
    const w = world();
    w.assign('chair', 'p-a');
    await w.tellNow();

    await w.reminders.sendDigests(C, '2026-10-17');

    expect(w.to('u-a').pop()?.title).toBe('Завтра у вас');
  });
});

describe('what stands between a press and a device', () => {
  // Pressed late in the evening, it is not lost — it waits for the morning.
  it('a press at night is held and delivered after eight', async () => {
    const w = world();
    w.at('2026-10-03T20:30:00Z'); // 22:30 in Berlin

    w.assign('chair', 'p-a');
    await w.tellNow();
    expect(w.pushes).toEqual([]);
    expect(w.outbox.rows[0].status).toBe('pending');

    w.at('2026-10-04T06:05:00Z'); // 08:05
    await w.notifications.deliverDue();
    expect(w.to('u-a').map((p) => p.title)).toEqual(['Вам назначено']);
  });

  it('a person who switched «Мои назначения» off hears nothing', async () => {
    const w = world();
    w.preferences.rows.push({
      userId: 'u-a',
      category: 'assignments',
      enabled: false,
    });

    w.assign('chair', 'p-a');
    await w.tellNow();

    expect(w.pushes).toEqual([]);
    expect(w.outbox.rows).toEqual([]);
  });

  it('with no device at all it goes by post, and the ledger says so', async () => {
    const w = world({ devices: { 'u-a': 'no_device' } });

    w.assign('chair', 'p-a');
    await w.tellNow();

    expect(w.pushes).toEqual([]);
    expect(w.letters.map((l) => l.title)).toEqual(['Вам назначено']);
    expect(w.outbox.rows[0].status).toBe('sent');
    expect(w.outbox.rows[0].channel).toBe('email');
  });

  it('every message that left is in the ledger with its road', async () => {
    const w = world({ devices: { 'u-a': 'web' } });

    w.assign('chair', 'p-a');
    await w.tellNow();

    expect(w.outbox.rows).toHaveLength(1);
    expect(w.outbox.rows[0]).toMatchObject({
      userId: 'u-a',
      kind: 'schedule',
      status: 'sent',
      channel: 'web',
    });
  });
});
