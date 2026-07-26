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
      find: jest.fn(async () => [{ id: 'cong-1', reportingStartMonth: null }]),
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

    await svc.remindPublishers();

    const body = notifications.notify.mock.calls[0][0].body as string;
    expect(body).toContain('закончился');
    expect(body).not.toContain('ещё не подали');
  });

  it('reminds plainly on the later evenings', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: missing });

    await svc.remindPublishers();

    expect(notifications.notify.mock.calls[0][0].body).toContain(
      'ещё не подали',
    );
  });

  it('says nothing to someone who has already reported', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: [] });

    await svc.remindPublishers();

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('carries a key, so a restarted job cannot tell anyone twice', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T16:00:00Z'));
    const { svc, notifications } = makeService({ publishers: missing });

    await svc.remindPublishers();

    expect(notifications.notify.mock.calls[0][0].key).toContain('2026-08-05');
  });
});
