jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { AssignmentRemindersService } from './assignment-reminders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { memRepo } from '../common/testing/mem-repo';
import { clockStub } from '../common/testing/clock-stub';

/**
 * A DUTY, FROM BEING WRITTEN IN TO THE PERSON'S DEVICE.
 *
 * Duties have no «опубликовать» and no «сообщить»: the coordinator taps a
 * name and it is saved. Until 3 October 2026 that told nobody. The real
 * reminders service and the real notification gateway run here over tables in
 * memory; only the push transport is a recorder.
 */

const C = 'cong-1';
const WEEK = '2026-10-05'; // Monday
const WEDNESDAY = '2026-10-07';
const NOW = new Date('2026-10-03T09:00:00Z'); // Saturday, 11:00 in Berlin
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

function world() {
  const publishers = memRepo<any>([
    { id: 'p-a', congregationId: C, userId: 'u-a', firstName: 'Андрей' },
    { id: 'p-b', congregationId: C, userId: 'u-b', firstName: 'Борис' },
    { id: 'p-x', congregationId: C, userId: null, firstName: 'Х' },
  ]);
  const users = memRepo<any>(
    ['a', 'b'].map((x) => ({
      id: `u-${x}`,
      uiLanguage: 'ru',
      isActive: true,
      email: `${x}@example.invalid`,
      reminderLadder: null,
    })),
  );
  const duties = memRepo<any>([]);
  const notices = memRepo<any>([]);
  const outbox = memRepo<any>([], {
    unique: ['congregationId', 'userId', 'dedupeKey'],
  });
  const pushes: { userId: string; title: string; body: string }[] = [];
  const notifications = new NotificationsService(
    outbox as any,
    memRepo<any>([]) as any,
    {
      sendToUsers: async (
        _t: string,
        ids: string[],
        title: string,
        body: string,
      ) => {
        for (const userId of ids) pushes.push({ userId, title, body });
        return new Map(ids.map((id) => [id, 'phone']));
      },
    } as any,
    clockStub('Europe/Berlin'),
    users as any,
    publishers as any,
    { sendNotice: async () => true } as any,
  );
  const reminders = new AssignmentRemindersService(
    memRepo<any>([]) as any, // parts
    duties as any,
    publishers as any,
    users as any,
    notices as any,
    memRepo<any>([{ id: C, timezone: 'Europe/Berlin', language: 'ru' }]) as any,
    memRepo<any>([]) as any,
    memRepo<any>([]) as any,
    memRepo<any>([]) as any,
    memRepo<any>([]) as any,
    {
      forWeeks: async (_c: string, weeks: string[]) =>
        new Map(
          weeks.map((w) => [
            w,
            {
              meetings:
                w === WEEK ? [{ kind: 'midweek', date: WEDNESDAY }] : [],
            },
          ]),
        ),
    } as any,
    { forRange: async () => [] } as any,
    notifications,
    memRepo<any>([]) as any, // field-service meetings
  );
  let n = 0;
  /** What DutiesService.assign leaves behind. */
  const duty = (over: Record<string, any>) => {
    const row = {
      id: `d-${(n += 1)}`,
      congregationId: C,
      weekStartDate: WEEK,
      eventType: 'midweek',
      dutyType: 'av',
      slotIndex: 0,
      customLabel: null,
      publisherId: 'p-a',
      updatedAt: minutesAgo(10),
      ...over,
    };
    duties.rows.push(row);
    return row;
  };
  const to = (userId: string) => pushes.filter((p) => p.userId === userId);
  return { reminders, duties, notices, pushes, duty, to };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(NOW);
});
afterEach(() => jest.useRealTimers());

describe('a duty given', () => {
  it('is said to the person as an assignment, once', async () => {
    const w = world();
    w.duty({});

    await w.reminders.announceDuties(NOW);
    await w.reminders.announceDuties(new Date(NOW.getTime() + 5 * 60_000));

    expect(w.to('u-a')).toHaveLength(1);
    expect(w.to('u-a')[0].title).toBe('Вам назначено');
    expect(w.to('u-a')[0].body).toBe(
      'Ср 7 октября, встреча среди недели: Аудио/Видео (через 4 дня)',
    );
  });

  // The coordinator saves forty times filling a month; nobody wants forty
  // notifications. Nothing is said until the editing has stopped.
  it('waits while the coordinator is still editing', async () => {
    const w = world();
    w.duty({ updatedAt: minutesAgo(1) });

    await w.reminders.announceDuties(NOW);

    expect(w.pushes).toEqual([]);
  });

  it('everything given in one sitting is one message', async () => {
    const w = world();
    w.duty({ dutyType: 'av' });
    w.duty({ dutyType: 'stage' });
    w.duty({ dutyType: 'attendant', publisherId: 'p-b' });

    await w.reminders.announceDuties(NOW);

    expect(w.to('u-a')).toHaveLength(1);
    expect(w.to('u-a')[0].body.split('\n')).toHaveLength(2);
    expect(w.to('u-b')).toHaveLength(1);
  });

  it('numbers a microphone when the meeting has several', async () => {
    const w = world();
    w.duty({ dutyType: 'microphone', slotIndex: 1 });
    w.duty({ dutyType: 'microphone', slotIndex: 0, publisherId: 'p-b' });

    await w.reminders.announceDuties(NOW);

    expect(w.to('u-a')[0].body).toContain('Микрофон 2');
  });

  it('says nothing to somebody without a login, and breaks nothing', async () => {
    const w = world();
    w.duty({ publisherId: 'p-x' });

    await w.reminders.announceDuties(NOW);

    expect(w.pushes).toEqual([]);
  });

  it('says nothing about a meeting that has passed', async () => {
    const w = world();
    w.duty({ weekStartDate: '2026-09-28' });

    await w.reminders.announceDuties(NOW);

    expect(w.pushes).toEqual([]);
  });

  // Otherwise the first run would announce every duty of the coming months.
  it('leaves what was written in long ago to the evening ladder', async () => {
    const w = world();
    w.duty({ updatedAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60_000) });

    await w.reminders.announceDuties(NOW);

    expect(w.pushes).toEqual([]);
  });
});

describe('a duty taken away or given to another', () => {
  it('tells the new person and the one replaced', async () => {
    const w = world();
    const d = w.duty({});
    await w.reminders.announceDuties(NOW);

    Object.assign(d, { publisherId: 'p-b', updatedAt: minutesAgo(6) });
    await w.reminders.announceDuties(new Date(NOW.getTime() + 60_000));

    expect(w.to('u-b').map((p) => p.title)).toEqual(['Вам назначено']);
    expect(w.to('u-a').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Назначение отменено',
    ]);
  });

  it('tells the person when the place is simply emptied', async () => {
    const w = world();
    const d = w.duty({});
    await w.reminders.announceDuties(NOW);

    Object.assign(d, { publisherId: null, updatedAt: minutesAgo(6) });
    await w.reminders.announceDuties(new Date(NOW.getTime() + 60_000));

    expect(w.to('u-a').pop()?.title).toBe('Назначение отменено');
    expect(w.notices.rows).toEqual([]);
  });

  it('tells the person when the duty itself is deleted', async () => {
    const w = world();
    w.duty({});
    await w.reminders.announceDuties(NOW);

    w.duties.rows.length = 0;
    await w.reminders.announceDuties(new Date(NOW.getTime() + 60_000));

    expect(w.to('u-a').pop()?.title).toBe('Назначение отменено');
  });

  it('given, taken and given again on one day: all three are heard', async () => {
    const w = world();
    const d = w.duty({});
    await w.reminders.announceDuties(NOW);
    Object.assign(d, { publisherId: null, updatedAt: minutesAgo(6) });
    await w.reminders.announceDuties(new Date(NOW.getTime() + 60_000));
    Object.assign(d, { publisherId: 'p-a', updatedAt: minutesAgo(6) });
    await w.reminders.announceDuties(new Date(NOW.getTime() + 120_000));

    expect(w.to('u-a').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Назначение отменено',
      'Вам назначено',
    ]);
  });
});

describe('together with the evening ladder', () => {
  it('a duty announced here is only recalled there', async () => {
    const w = world();
    w.duty({});
    await w.reminders.announceDuties(NOW);

    await w.reminders.sendDigests(C, '2026-10-06'); // the evening before

    expect(w.to('u-a').map((p) => p.title)).toEqual([
      'Вам назначено',
      'Завтра у вас',
    ]);
  });
});
