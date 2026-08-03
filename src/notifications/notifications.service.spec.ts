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

import { NotificationsService } from './notifications.service';
import { clockStub } from '../common/testing/clock-stub';

const TZ = 'Europe/Berlin';

function makeService(over: Partial<Record<string, any>> = {}) {
  const rows: any[] = [];
  const outboxRepo = {
    create: (x: any) => ({ id: `row-${rows.length + 1}`, ...x }),
    insert: jest.fn(async (row: any) => {
      if (
        row.dedupeKey &&
        rows.some(
          (r) =>
            r.congregationId === row.congregationId &&
            r.userId === row.userId &&
            r.dedupeKey === row.dedupeKey,
        )
      ) {
        throw new Error('duplicate key value violates unique constraint');
      }
      rows.push(row);
    }),
    update: jest.fn(async (where: any, patch: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, patch);
    }),
    find: jest.fn(async () => rows.filter((r) => r.status === 'pending')),
    createQueryBuilder: jest.fn(),
    ...(over.outboxRepo ?? {}),
  } as any;
  const congregationsRepo = {
    findOne: jest.fn(async () => ({ id: 'cong-1', timezone: TZ })),
  } as any;
  // Nothing switched off unless a test says so.
  const preferencesRepo = {
    find: jest.fn(async () => over.switchedOff ?? []),
    findOne: jest.fn(async () => null),
    insert: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  } as any;
  const push = {
    sendToUsers: jest.fn().mockResolvedValue(undefined),
    ...(over.push ?? {}),
  } as any;
  const svc = new NotificationsService(
    outboxRepo,
    preferencesRepo,
    push,
    clockStub(over.timezone ?? 'Europe/Berlin'),
  );
  return { svc, rows, push, outboxRepo, preferencesRepo };
}

const base = {
  tenantId: 'cong-1',
  title: 'Отчёт о служении',
  body: 'Вы ещё не подали отчёт.',
  data: { type: 'report_reminder' },
  kind: 'report_reminder',
};

describe('NotificationsService.computeNotBefore', () => {
  // The whole point: a job that fires at three in the morning must not wake
  // anyone. It is held, not dropped.
  it('holds a night-time notification until the morning', () => {
    // 02:30 UTC in July is 04:30 in Berlin — the middle of the night.
    const at = new Date('2026-07-15T02:30:00Z');
    const notBefore = NotificationsService.computeNotBefore(at, TZ);
    expect(notBefore).not.toBeNull();
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: '2-digit',
      hour12: false,
    }).format(notBefore!);
    expect(Number(local)).toBe(8);
    expect(notBefore!.getTime()).toBeGreaterThan(at.getTime());
  });

  it('sends straight away during the day', () => {
    // 16:00 UTC is 18:00 in Berlin — when the report reminders run.
    const at = new Date('2026-07-15T16:00:00Z');
    expect(NotificationsService.computeNotBefore(at, TZ)).toBeNull();
  });

  it('holds a late-evening notification too', () => {
    // 21:30 UTC is 23:30 in Berlin.
    const at = new Date('2026-07-15T21:30:00Z');
    expect(NotificationsService.computeNotBefore(at, TZ)).not.toBeNull();
  });

  it('honours urgent, which is what urgent is for', () => {
    const at = new Date('2026-07-15T02:30:00Z');
    expect(NotificationsService.computeNotBefore(at, TZ, true)).toBeNull();
  });
});

describe('NotificationsService.notify', () => {
  it('sends during the day and records that it did', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, rows, push } = makeService();

    await svc.notify({ ...base, userIds: ['u1'] });

    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sentAt).toBeInstanceOf(Date);
    jest.useRealTimers();
  });

  it('withholds a night-time notification and leaves it for the tick', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T02:30:00Z'));
    const { svc, rows, push } = makeService();

    await svc.notify({ ...base, userIds: ['u1'] });

    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('pending');
    expect(rows[0].notBefore).toBeInstanceOf(Date);
    jest.useRealTimers();
  });

  // A restarted container or a retried tick must not say the same thing twice.
  it('says a keyed thing once, however many times it is asked', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, push } = makeService();

    await svc.notify({ ...base, userIds: ['u1'], key: 'report:2026-06:u1' });
    await svc.notify({ ...base, userIds: ['u1'], key: 'report:2026-06:u1' });
    await svc.notify({ ...base, userIds: ['u1'], key: 'report:2026-06:u1' });

    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('without a key it may repeat — an edited meeting is news twice', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, push } = makeService();

    await svc.notify({ ...base, userIds: ['u1'] });
    await svc.notify({ ...base, userIds: ['u1'] });

    expect(push.sendToUsers).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('one row per person, so the key protects each of them', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, rows } = makeService();

    await svc.notify({ ...base, userIds: ['u1', 'u2', 'u1'], key: 'k-1' });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
    jest.useRealTimers();
  });

  // A notification that cannot be delivered must never break what was being
  // done — a failed push is not a reason to fail a saved schedule.
  it('never throws when the send fails', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, rows } = makeService({
      push: { sendToUsers: jest.fn().mockRejectedValue(new Error('boom')) },
    });

    await expect(
      svc.notify({ ...base, userIds: ['u1'] }),
    ).resolves.toBeUndefined();
    expect(rows[0].status).toBe('failed');
    jest.useRealTimers();
  });
});

describe('NotificationsService.deliverDue', () => {
  it('delivers what was held overnight', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T02:30:00Z'));
    const { svc, rows, push } = makeService();
    await svc.notify({ ...base, userIds: ['u1'] });
    expect(push.sendToUsers).not.toHaveBeenCalled();

    jest.setSystemTime(new Date('2026-07-15T06:05:00Z')); // 08:05 in Berlin
    const { sent } = await svc.deliverDue();

    expect(sent).toBe(1);
    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe('sent');
    jest.useRealTimers();
  });
});

describe('NotificationsService — what a person chose not to hear', () => {
  it('says nothing to someone who switched that category off', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, push, rows } = makeService({
      switchedOff: [{ userId: 'u1', category: 'reports', enabled: false }],
    });

    await svc.notify({ ...base, userIds: ['u1'] }); // kind: report_reminder

    expect(push.sendToUsers).not.toHaveBeenCalled();
    // And nothing is written down: a ledger that records what was deliberately
    // not sent would lie about what the congregation receives.
    expect(rows).toHaveLength(0);
    jest.useRealTimers();
  });

  it('still reaches the others in the same send', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, push } = makeService({
      switchedOff: [{ userId: 'u1', category: 'reports', enabled: false }],
    });

    await svc.notify({ ...base, userIds: ['u1', 'u2'] });

    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    expect(push.sendToUsers.mock.calls[0][1]).toEqual(['u2']);
    jest.useRealTimers();
  });
});
