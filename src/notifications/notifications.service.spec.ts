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

import { NotificationsService, fitKey } from './notifications.service';
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
        // What Postgres really says: the code is the only thing notify() may
        // read as «already said».
        throw Object.assign(
          new Error('duplicate key value violates unique constraint'),
          { code: '23505' },
        );
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
    // Everybody asked for is reached on a phone unless a test says otherwise.
    sendToUsers: jest.fn(
      async (_t: string, ids: string[]) =>
        new Map(ids.map((id) => [id, over.reach ?? 'phone'])),
    ),
    sendToDevice: jest.fn(async () => over.deviceReach ?? 'web'),
    ...(over.push ?? {}),
  } as any;
  const usersRepo = {
    findOne: jest.fn(async () =>
      'user' in over
        ? over.user
        : {
            id: 'u1',
            email: 'u1@example.invalid',
            uiLanguage: 'ru',
            isActive: true,
          },
    ),
  } as any;
  const publishersRepo = {
    findOne: jest.fn(async () => ({ id: 'p1', firstName: 'Вера' })),
  } as any;
  const mail = {
    sendNotice: jest.fn(async () => over.mailLeaves ?? true),
  } as any;
  const svc = new NotificationsService(
    outboxRepo,
    preferencesRepo,
    push,
    clockStub(over.timezone ?? 'Europe/Berlin'),
    usersRepo,
    publishersRepo,
    mail,
  );
  return { svc, rows, push, outboxRepo, preferencesRepo, mail };
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

describe('NotificationsService — the dedupe key travels with the message', () => {
  // A browser replaces a notification whose tag is already on screen. The
  // service worker had nothing to tell two messages apart, so a cleaning
  // reminder followed by a task assignment left only the task. The key that
  // keeps this row from being sent twice is the right name for it — it was
  // computed and stored, and simply never left the database.
  it('passes the key on so the browser can tell two messages apart', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, push } = makeService();

    await svc.notify({
      ...base,
      userIds: ['u1'],
      key: 'task-assigned:task-9',
    });

    const data = (push.sendToUsers as jest.Mock).mock.calls[0][4];
    expect(data).toEqual({
      type: 'report_reminder',
      notificationKey: 'task-assigned:task-9',
    });
    jest.useRealTimers();
  });

  it('leaves the payload alone when there is no key', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
    const { svc, push } = makeService();

    await svc.notify({ ...base, userIds: ['u1'] });

    const data = (push.sendToUsers as jest.Mock).mock.calls[0][4];
    expect(data).toEqual({ type: 'report_reminder' });
    jest.useRealTimers();
  });

  it('carries it through the overnight hold as well', async () => {
    // Held at 03:00 and delivered by the tick — the same path, and the key
    // must survive the wait.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T02:30:00Z'));
    const { svc, push } = makeService();
    await svc.notify({ ...base, userIds: ['u1'], key: 'meeting-tomorrow:m1' });
    expect(push.sendToUsers).not.toHaveBeenCalled();

    await svc.deliverDue(new Date('2026-07-15T06:00:00Z'));

    const data = (push.sendToUsers as jest.Mock).mock.calls[0][4];
    expect(data.notificationKey).toBe('meeting-tomorrow:m1');
    jest.useRealTimers();
  });
});

/**
 * The audit of 1 October 2026: the ledger said «sent» for four rows in ten
 * that had gone nowhere, and one whole kind had never been sent at all.
 */
describe('NotificationsService — what really happened to it', () => {
  const day = () =>
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
  afterEach(() => jest.useRealTimers());

  it('records the road that carried it', async () => {
    day();
    const { svc, rows } = makeService({ reach: 'web' });

    await svc.notify({ ...base, userIds: ['u1'] });

    expect(rows[0].status).toBe('sent');
    expect(rows[0].channel).toBe('web');
  });

  it('nowhere to send is not «sent»', async () => {
    day();
    const { svc, rows } = makeService({ reach: 'no_device' });

    await svc.notify({ ...base, userIds: ['u1'] });

    expect(rows[0].status).toBe('no_device');
    expect(rows[0].channel).toBeNull();
    expect(rows[0].sentAt).toBeNull();
  });

  it('a device that took nothing is recorded as failed', async () => {
    day();
    const { svc, rows } = makeService({ reach: 'failed' });

    await svc.notify({ ...base, userIds: ['u1'] });

    expect(rows[0].status).toBe('failed');
  });

  // The Memorial's key is two uuids and a word between them: 99–100
  // characters against a column of 96. The insert failed, the failure was read
  // as a repeat, and nobody was ever told.
  it('a key longer than the column is still sent — and still said once', async () => {
    day();
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const key = `memorial:${id}:memorialPublished:${id}`;
    expect(key.length).toBeGreaterThan(96);
    const { svc, rows, push, outboxRepo } = makeService();
    // The column itself, as the database enforces it.
    const insert = outboxRepo.insert.getMockImplementation();
    outboxRepo.insert.mockImplementation(async (row: any) => {
      if (row.dedupeKey && row.dedupeKey.length > 96) {
        throw Object.assign(new Error('value too long'), { code: '22001' });
      }
      return insert(row);
    });

    await svc.notify({ ...base, userIds: ['u1'], key });
    await svc.notify({ ...base, userIds: ['u1'], key });

    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    expect(rows[0].dedupeKey.length).toBeLessThanOrEqual(96);
  });

  it('two long keys that differ only at the end stay different', () => {
    const head =
      'memorial:0f8fad5b-d9cb-469f-a165-70867728950e:memorialTomorrow:';
    const a = fitKey(`${head}11111111-1111-1111-1111-111111111111`);
    const b = fitKey(`${head}22222222-2222-2222-2222-222222222222`);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(96);
    expect(fitKey('short')).toBe('short');
  });

  // Only a repeat may be passed over in silence. Any other refusal is a
  // notification that was not sent, and it has to leave a line.
  it('an insert that fails for another reason is reported, not taken for a repeat', async () => {
    day();
    const { svc, push } = makeService({
      outboxRepo: {
        insert: jest.fn(async () => {
          throw Object.assign(new Error('value too long'), { code: '22001' });
        }),
      },
    });
    const error = jest
      .spyOn((svc as any).logger, 'error')
      .mockImplementation(() => undefined);

    await svc.notify({ ...base, userIds: ['u1'], key: 'k' });

    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsService.sendTest', () => {
  afterEach(() => jest.useRealTimers());

  // Somebody pressing «Отправить пробное» at night is awake.
  it('goes out at once, even at night, and says where it went', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T02:30:00Z'));
    const { svc, rows, push } = makeService({ reach: 'web' });

    const res = await svc.sendTest('cong-1', 'u1', 'ru');

    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ status: 'sent', channel: 'web' });
    expect(rows[0].kind).toBe('test');
    expect(rows[0].notBefore).toBeNull();
  });

  it('says plainly when there is no device to send to', async () => {
    const { svc } = makeService({ reach: 'no_device' });

    const res = await svc.sendTest('cong-1', 'u1', 'de');

    expect(res).toEqual({ status: 'no_device', channel: null });
  });

  // A test is not news: the category switches do not apply to it.
  it('ignores the category switches', async () => {
    const { svc, push } = makeService({
      switchedOff: [{ userId: 'u1' }],
    });

    await svc.sendTest('cong-1', 'u1', 'ru');

    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
  });
});

/**
 * A third of the people using the app had no device a notification could
 * reach. For their own assignments — and only for those — the same words go
 * by post.
 */
describe('NotificationsService — a letter when there is no device', () => {
  const day = () =>
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:00:00Z'));
  afterEach(() => jest.useRealTimers());
  const digest = { ...base, kind: 'assignment_reminder', emailFallback: true };

  it('goes by post, named, and is recorded as sent by e-mail', async () => {
    day();
    const { svc, rows, mail } = makeService({ reach: 'no_device' });

    await svc.notify({ ...digest, userIds: ['u1'] });

    expect(mail.sendNotice).toHaveBeenCalledTimes(1);
    const [to, lang, notice] = mail.sendNotice.mock.calls[0];
    expect(to).toBe('u1@example.invalid');
    expect(lang).toBe('ru');
    expect(notice.recipientName).toBe('Вера');
    expect(notice.body).toBe(base.body);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].channel).toBe('email');
  });

  it('is not written to somebody a device already reached', async () => {
    day();
    const { svc, mail } = makeService({ reach: 'phone' });

    await svc.notify({ ...digest, userIds: ['u1'] });

    expect(mail.sendNotice).not.toHaveBeenCalled();
  });

  // Cleaning, reports, events: a mailbox filling with those would be its own
  // complaint. Only what is marked goes by post.
  it('is not written for a kind that did not ask for it', async () => {
    day();
    const { svc, rows, mail } = makeService({ reach: 'no_device' });

    await svc.notify({ ...base, userIds: ['u1'] });

    expect(mail.sendNotice).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('no_device');
  });

  it('stays «некуда отправить» when there is no address either', async () => {
    day();
    const { svc, rows, mail } = makeService({
      reach: 'no_device',
      user: { id: 'u1', email: null, uiLanguage: 'ru', isActive: true },
    });

    await svc.notify({ ...digest, userIds: ['u1'] });

    expect(mail.sendNotice).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('no_device');
  });

  it('stays «некуда отправить» when the letter did not leave', async () => {
    day();
    const { svc, rows } = makeService({
      reach: 'no_device',
      mailLeaves: false,
    });

    await svc.notify({ ...digest, userIds: ['u1'] });

    expect(rows[0].status).toBe('no_device');
  });

  // Held overnight, delivered by the tick — the mark must survive the wait.
  it('still goes by post when it was held until the morning', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T02:30:00Z'));
    const { svc, rows, mail } = makeService({ reach: 'no_device' });

    await svc.notify({ ...digest, userIds: ['u1'] });
    expect(mail.sendNotice).not.toHaveBeenCalled();
    await svc.deliverDue(new Date('2026-07-15T07:00:00Z'));

    expect(mail.sendNotice).toHaveBeenCalledTimes(1);
    expect(rows[0].channel).toBe('email');
  });
});

/**
 * «Отправить пробное» asks about the device in the person's hand. Sent the
 * ordinary way it went to the phone the person's account prefers — pressed on
 * an iPad, it arrived on an Android phone, and the iPad looked broken.
 */
describe('NotificationsService.sendTest — to the device that asked', () => {
  it('goes to that device only, not through the ordinary choice of devices', async () => {
    const { svc, push, rows } = makeService({ deviceReach: 'web' });

    const res = await svc.sendTest('cong-1', 'u1', 'ru', {
      endpoint: 'https://web.push.apple.com/abc',
    });

    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(push.sendToDevice).toHaveBeenCalledTimes(1);
    expect(push.sendToDevice.mock.calls[0][2]).toEqual({
      endpoint: 'https://web.push.apple.com/abc',
    });
    expect(res).toEqual({ status: 'sent', channel: 'web' });
    expect(rows[0].status).toBe('sent');
    expect(rows[0].channel).toBe('web');
  });

  it('says so when this device is not registered, whatever else the person has', async () => {
    const { svc, rows } = makeService({ deviceReach: 'no_device' });

    const res = await svc.sendTest('cong-1', 'u1', 'ru', {
      endpoint: 'https://web.push.apple.com/unknown',
    });

    expect(res).toEqual({ status: 'no_device', channel: null });
    expect(rows[0].status).toBe('no_device');
  });

  it('an older app, which names no device, is answered as before', async () => {
    const { svc, push } = makeService({ reach: 'phone' });

    const res = await svc.sendTest('cong-1', 'u1', 'ru', {});

    expect(push.sendToDevice).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'sent', channel: 'phone' });
  });
});
