jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { AssignmentRemindersService } from './assignment-reminders.service';
import { memRepo } from '../common/testing/mem-repo';
import { realGateway } from '../common/testing/real-gateway';

/**
 * THE HALL'S CLEANING AND A TALK AWAY, from the tables to the device.
 *
 * Both are things a person does on a known day that the evening digest left
 * out until 3 October 2026. The real reminders service asks real questions of
 * tables in memory here (so a wrong `where` is seen), and the real gateway
 * decides who is reached and how.
 */

const C = 'cong-1';
const WEEK = '2026-10-05'; // Monday
const WEDNESDAY = '2026-10-07';
const SUNDAY = '2026-10-11';

function world(
  over: { preferences?: any[]; noDevice?: string[]; meetings?: any[] } = {},
) {
  const publishers = memRepo<any>([
    { id: 'p-a', congregationId: C, userId: 'u-a', serviceGroupId: 'g1' },
    { id: 'p-b', congregationId: C, userId: 'u-b', serviceGroupId: 'g2' },
    { id: 'p-c', congregationId: C, userId: 'u-c', serviceGroupId: 'g1' },
  ]);
  const users = memRepo<any>(
    ['a', 'b', 'c'].map((x) => ({
      id: `u-${x}`,
      uiLanguage: x === 'c' ? 'de' : 'ru',
      isActive: true,
      email: `${x}@example.invalid`,
      reminderLadder: null,
    })),
  );
  const cleaning = memRepo<any>([]);
  const talks = memRepo<any>([]);
  const parts = memRepo<any>([]);
  const gateway = realGateway({
    users,
    publishers,
    preferences: over.preferences,
    noDevice: over.noDevice,
  });
  const meetings = over.meetings ?? [
    { kind: 'midweek', date: WEDNESDAY },
    { kind: 'weekend', date: SUNDAY },
  ];
  const reminders = new AssignmentRemindersService(
    parts as any,
    memRepo<any>([]) as any, // duties
    publishers as any,
    users as any,
    memRepo<any>([]) as any, // marks
    memRepo<any>([{ id: C, timezone: 'Europe/Berlin', language: 'ru' }]) as any,
    memRepo<any>([]) as any,
    memRepo<any>([]) as any,
    memRepo<any>([]) as any,
    memRepo<any>([]) as any,
    {
      forWeeks: async (_c: string, weeks: string[]) =>
        new Map(
          weeks.map((w) => [w, { meetings: w === WEEK ? meetings : [] }]),
        ),
    } as any,
    { forRange: async () => [] } as any,
    gateway.notifications,
    memRepo<any>([]) as any, // field-service meetings
    cleaning as any,
    talks as any,
    memRepo<any>([
      {
        id: 'h1',
        congregationId: C,
        name: 'Dortmund-Russisch',
        meetingTime: '10:00',
      },
    ]) as any,
  );
  const cleans = (over2: Record<string, any> = {}) =>
    cleaning.rows.push({
      id: `cl-${cleaning.rows.length + 1}`,
      congregationId: C,
      weekStartDate: WEEK,
      slotType: 'after_meeting',
      serviceGroupId: 'g1',
      ...over2,
    });
  const talk = (over2: Record<string, any> = {}) =>
    talks.rows.push({
      id: `tx-${talks.rows.length + 1}`,
      congregationId: C,
      direction: 'outgoing',
      status: 'confirmed',
      date: SUNDAY,
      publisherId: 'p-a',
      hostCongregationId: 'h1',
      deletedAt: null,
      ...over2,
    });
  return { reminders, cleans, talk, ...gateway };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-10-06T16:30:00Z')); // Tuesday, 18:30
});
afterEach(() => jest.useRealTimers());

describe("the group's week of cleaning", () => {
  it('is said the evening before each meeting, to the group and nobody else', async () => {
    const w = world();
    w.cleans();

    await w.reminders.sendDigests(C, '2026-10-06'); // before Wednesday
    await w.reminders.sendDigests(C, '2026-10-10'); // before Sunday

    expect(w.to('u-a').map((p) => `${p.title} / ${p.body}`)).toEqual([
      'Завтра у вас / Ср 7 октября, встреча среди недели: уборка после встречи (ваша группа)',
      'Завтра у вас / Вс 11 октября, встреча в выходные: уборка после встречи (ваша группа)',
    ]);
    // The same, to the other member of the group, in HIS language.
    expect(w.to('u-c')[0].body).toBe(
      'Mi 7. Oktober, Zusammenkunft unter der Woche: Reinigung nach der Zusammenkunft (eure Gruppe)',
    );
    // Another group hears nothing.
    expect(w.to('u-b')).toEqual([]);
  });

  // Two groups in view at once — this week's and next week's — must not be
  // told of each other's week.
  it('next week another group cleans: each hears only of its own', async () => {
    const w = world({
      meetings: [{ kind: 'midweek', date: WEDNESDAY }],
    });
    w.cleans();
    w.cleans({ weekStartDate: '2026-10-12', serviceGroupId: 'g2' });

    await w.reminders.sendDigests(C, '2026-10-06');

    expect(w.to('u-a')).toHaveLength(1);
    expect(w.to('u-c')).toHaveLength(1);
    expect(w.to('u-b')).toEqual([]);
  });

  it('is not said on the other evenings of the week', async () => {
    const w = world();
    w.cleans();

    for (const day of [
      '2026-10-05',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]) {
      await w.reminders.sendDigests(C, day);
    }

    expect(w.pushes).toEqual([]);
  });

  it('the weekly and the general cleaning are not this line', async () => {
    const w = world();
    w.cleans({ slotType: 'thorough' });
    w.cleans({ slotType: 'general' });

    await w.reminders.sendDigests(C, '2026-10-06');

    expect(w.pushes).toEqual([]);
  });

  // A convention week has no meeting to clean up after.
  it('a meeting that is not held has no cleaning to recall', async () => {
    const w = world({ meetings: [{ kind: 'weekend', date: SUNDAY }] });
    w.cleans();

    await w.reminders.sendDigests(C, '2026-10-06');

    expect(w.pushes).toEqual([]);
  });

  it('whoever switched cleaning off does not get it back through the digest', async () => {
    const w = world({
      preferences: [{ userId: 'u-a', category: 'cleaning', enabled: false }],
    });
    w.cleans();

    await w.reminders.sendDigests(C, '2026-10-06');

    expect(w.to('u-a')).toEqual([]);
    expect(w.to('u-c')).toHaveLength(1);
  });

  // A mailbox filling with cleaning reminders would be a complaint of its own.
  it('goes to a device, never by post', async () => {
    const w = world({ noDevice: ['u-a'] });
    w.cleans();

    await w.reminders.sendDigests(C, '2026-10-06');

    expect(w.letters).toEqual([]);
    expect(w.outbox.rows.find((r) => r.userId === 'u-a')).toMatchObject({
      status: 'no_device',
    });
  });
});

describe('a talk one of ours gives elsewhere', () => {
  it('comes back a week before and the evening before, to him alone', async () => {
    const w = world();
    w.talk();

    await w.reminders.sendDigests(C, '2026-10-04'); // a week before
    await w.reminders.sendDigests(C, '2026-10-10'); // the evening before

    expect(w.pushes.map((p) => `${p.userId} · ${p.title} / ${p.body}`)).toEqual(
      [
        'u-a · Ваши ближайшие задания / Вс 11 октября (через неделю), 10:00: ваша речь в собрании Dortmund-Russisch',
        'u-a · Завтра у вас / Вс 11 октября, 10:00: ваша речь в собрании Dortmund-Russisch',
      ],
    );
  });

  // His own assignment: this one IS worth a letter.
  it('goes by post to somebody with no device', async () => {
    const w = world({ noDevice: ['u-a'] });
    w.talk();

    await w.reminders.sendDigests(C, '2026-10-10');

    expect(w.letters).toEqual([
      {
        to: 'a@example.invalid',
        title: 'Завтра у вас',
        body: expect.stringContaining('Dortmund-Russisch'),
      },
    ]);
  });

  it('an entry removed, or one that did not happen, is not recalled', async () => {
    const w = world();
    w.talk({ deletedAt: new Date() });
    w.talk({ status: 'did_not_happen' });

    await w.reminders.sendDigests(C, '2026-10-10');

    expect(w.pushes).toEqual([]);
  });

  it('a visiting speaker coming to us is not a talk of ours', async () => {
    const w = world();
    w.talk({ direction: 'incoming' });

    await w.reminders.sendDigests(C, '2026-10-10');

    expect(w.pushes).toEqual([]);
  });
});
