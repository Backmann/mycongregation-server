jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(m: unknown[]) {
      return [m];
    }
    sendPushNotificationsAsync = jest.fn().mockResolvedValue([]);
  }
  return { Expo: MockExpo };
});

import { ReportRemindersService } from './report-reminders.service';

/**
 * A reminder every evening from the 1st to the 10th was not persistence but
 * nagging, and what people do about nagging is switch notifications off — and
 * then miss the assignment they did want. Three evenings, then the matter
 * moves up to the overseer and the secretary.
 */
describe('ReportRemindersService — how often, and in what tone', () => {
  function makeService(over: Record<string, any> = {}) {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const congregationsRepo = {
      find: jest.fn(async () => [
        {
          id: 'cong-1',
          timezone: over.timezone ?? 'Europe/Berlin',
          language: over.language ?? 'ru',
        },
      ]),
    };
    const publishersRepo = {
      find: jest.fn(async () => over.publishers ?? []),
    };
    const reportsRepo = { find: jest.fn(async () => []) };
    const groupsRepo = { find: jest.fn(async () => []) };
    const userRepo = { find: jest.fn(async () => []) };
    // Constructor order: publishers, reports, groups, responsibilities,
    // congregations, users, push, notifications.
    const svc = new ReportRemindersService(
      publishersRepo as any,
      reportsRepo as any,
      groupsRepo as any,
      { find: jest.fn(async () => []) } as any,
      congregationsRepo as any,
      userRepo as any,
      {} as any,
      notifications as any,
    );
    return { svc, notifications };
  }

  // A publisher with a login and no report for the month.
  const missing = [
    { id: 'p1', userId: 'u1', displayName: 'Брат А', serviceGroupId: 'g1' },
  ];

  afterEach(() => jest.useRealTimers());

  it('opens the month rather than reproaching on the 1st', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: missing });

    await svc.tick();

    const body = notifications.notify.mock.calls[0][0].body as string;
    expect(body).toContain('закончился');
    expect(body).not.toContain('ещё не подали');
  });

  it('reminds plainly on the later evenings', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: missing });

    await svc.tick();

    expect(notifications.notify.mock.calls[0][0].body).toContain(
      'ещё не подали',
    );
  });

  it('says nothing to someone who has already reported', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: [] });

    await svc.tick();

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('waits for six in the evening WHERE THE CONGREGATION IS', async () => {
    // 16:00 UTC is 18:00 in Berlin and 11:00 in Chicago. The job used to fire
    // on Berlin's clock for everyone, so a congregation a few hours away was
    // nudged in the middle of its afternoon.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));

    const chicago = makeService({
      publishers: missing,
      timezone: 'America/Chicago',
    });
    await chicago.svc.tick();
    expect(chicago.notifications.notify).not.toHaveBeenCalled();

    const berlin = makeService({ publishers: missing });
    await berlin.svc.tick();
    expect(berlin.notifications.notify).toHaveBeenCalled();
  });

  it('reaches that same congregation when ITS evening comes', async () => {
    // 23:00 UTC is 18:00 in Chicago.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T23:00:00Z'));
    const { svc, notifications } = makeService({
      publishers: missing,
      timezone: 'America/Chicago',
    });

    await svc.tick();

    expect(notifications.notify).toHaveBeenCalled();
    // And the key carries ITS date, not the server's.
    expect(notifications.notify.mock.calls[0][0].key).toContain('2026-08-05');
  });

  it('reaches a half-hour timezone, where an hourly tick never lands on the hour', async () => {
    // India is +05:30: at every whole UTC hour the local clock reads :30, so
    // "the hour is exactly 18" would have skipped the country entirely.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T13:00:00Z')); // 18:30 IST
    const { svc, notifications } = makeService({
      publishers: missing,
      timezone: 'Asia/Kolkata',
    });

    await svc.tick();

    expect(notifications.notify).toHaveBeenCalled();
  });

  it('says the same thing on every later tick of the same evening', async () => {
    // The tick runs hourly, so an evening is visited several times. The key is
    // what stops the second visit from telling anyone again — it must be the
    // same key, or the dedupe is worthless.
    const keys: string[] = [];
    for (const at of ['2026-08-05T16:00:00Z', '2026-08-05T20:00:00Z']) {
      jest.useFakeTimers().setSystemTime(new Date(at));
      const { svc, notifications } = makeService({ publishers: missing });
      await svc.tick();
      keys.push(notifications.notify.mock.calls[0][0].key as string);
    }
    expect(keys[0]).toBe(keys[1]);
  });

  it('speaks the congregation\u2019s language', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));
    const { svc, notifications } = makeService({
      publishers: missing,
      language: 'de',
    });

    await svc.tick();

    const call = notifications.notify.mock.calls[0][0];
    expect(call.title).toBe('Predigtdienstbericht');
    expect(call.body).toContain('Juli');
    expect(call.body).not.toMatch(/[\u0410-\u044f]/);
  });

  it('says nothing at all on a day that is not in the ladder', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-06T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: missing });

    await svc.tick();

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('carries a key, so a restarted job cannot tell anyone twice', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: missing });

    await svc.tick();

    expect(notifications.notify.mock.calls[0][0].key).toContain('2026-08-05');
  });
});
