jest.mock('expo-server-sdk', () => {
  const send = jest.fn();
  class MockExpo {
    static isExpoPushToken() {
      return true;
    }
    static __send = send;
    chunkPushNotifications(m: unknown[]) {
      return [m];
    }
    sendPushNotificationsAsync = send;
  }
  return { Expo: MockExpo };
});

import { Expo } from 'expo-server-sdk';
import { PushNotificationsService } from './push-notifications.service';

const send = (Expo as unknown as { __send: jest.Mock }).__send;

/**
 * Someone with the app AND browser notifications used to be told everything
 * twice. That reads as carelessness, and carelessness is a good reason to
 * switch notifications off altogether.
 */
describe('PushNotificationsService.sendToUsers — one person, one channel', () => {
  const TENANT = 'cong-1';

  function build(over: {
    tokens?: { token: string; userId: string }[];
    subs?: { userId: string; endpoint: string }[];
    ticketStatus?: 'ok' | 'error';
    webOk?: boolean;
  }) {
    const tokens = over.tokens ?? [];
    const subs = over.subs ?? [];
    send.mockReset();
    send.mockResolvedValue(
      tokens.map(() =>
        over.ticketStatus === 'error'
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: 'ticket-1' },
      ),
    );
    const sendToSubscription = jest
      .fn()
      .mockResolvedValue(
        over.webOk === false
          ? { ok: false, errorCode: 'SendError' }
          : { ok: true, errorCode: null },
      );
    // Constructor order: push tokens, users, receipts, web push.
    const svc = new PushNotificationsService(
      { find: jest.fn(async () => tokens), delete: jest.fn() } as any,
      { find: jest.fn(async () => []) } as any,
      {
        save: jest.fn(),
        find: jest.fn(async () => []),
        delete: jest.fn(),
      } as any,
      {
        getSubscriptionsByTenant: jest.fn(async () => subs),
        sendToSubscription,
      } as any,
    );
    return { svc, sendToSubscription };
  }

  const say = (svc: PushNotificationsService, userIds: string[]) =>
    svc.sendToUsers(TENANT, userIds, 'Заголовок', 'Текст', { type: 't' });

  it('uses the phone and leaves the browser alone', async () => {
    const { svc, sendToSubscription } = build({
      tokens: [{ token: 'ExponentPushToken[a]', userId: 'u1' }],
      subs: [{ userId: 'u1', endpoint: 'https://push/1' }],
    });

    await say(svc, ['u1']);

    expect(send).toHaveBeenCalledTimes(1);
    expect(sendToSubscription).not.toHaveBeenCalled();
  });

  it('uses the browser for someone with no phone registered', async () => {
    const { svc, sendToSubscription } = build({
      tokens: [],
      subs: [{ userId: 'u2', endpoint: 'https://push/2' }],
    });

    await say(svc, ['u2']);

    expect(sendToSubscription).toHaveBeenCalledTimes(1);
  });

  // A message that reached nobody is worse than one that arrived twice.
  it('falls back to the browser when the phone send failed outright', async () => {
    const { svc, sendToSubscription } = build({
      tokens: [{ token: 'ExponentPushToken[a]', userId: 'u1' }],
      subs: [{ userId: 'u1', endpoint: 'https://push/1' }],
      ticketStatus: 'error',
    });

    await say(svc, ['u1']);

    expect(sendToSubscription).toHaveBeenCalledTimes(1);
  });

  it('decides per person, not for everyone at once', async () => {
    const { svc, sendToSubscription } = build({
      tokens: [{ token: 'ExponentPushToken[a]', userId: 'u1' }],
      subs: [
        { userId: 'u1', endpoint: 'https://push/1' },
        { userId: 'u2', endpoint: 'https://push/2' },
      ],
    });

    await say(svc, ['u1', 'u2']);

    // u1 was reached on his phone; only u2 needs the browser.
    expect(sendToSubscription).toHaveBeenCalledTimes(1);
    expect(sendToSubscription.mock.calls[0][0].userId).toBe('u2');
  });

  // The ledger used to write «sent» for everybody. What it needs to know is
  // where each person was actually reached — or that there was nowhere to send.
  describe('says where each person was reached', () => {
    it('phone, browser, nowhere and failed are four different answers', async () => {
      const { svc } = build({
        tokens: [{ token: 'ExponentPushToken[a]', userId: 'u1' }],
        subs: [{ userId: 'u2', endpoint: 'https://push/2' }],
      });

      const reach = await say(svc, ['u1', 'u2', 'u3']);

      expect(reach.get('u1')).toBe('phone');
      expect(reach.get('u2')).toBe('web');
      // No token and no subscription: not our failure, and not «sent».
      expect(reach.get('u3')).toBe('no_device');
    });

    it('a device that took nothing is a failure, not an absence', async () => {
      const { svc } = build({
        tokens: [{ token: 'ExponentPushToken[a]', userId: 'u1' }],
        subs: [{ userId: 'u2', endpoint: 'https://push/2' }],
        ticketStatus: 'error',
        webOk: false,
      });

      const reach = await say(svc, ['u1', 'u2']);

      expect(reach.get('u1')).toBe('failed');
      expect(reach.get('u2')).toBe('failed');
    });
  });

  // A token names the device. A second person signing in on the same phone
  // left the first one's row behind, and his notifications kept arriving there.
  it('a phone belongs to whoever registered it last', async () => {
    const del = jest.fn();
    const svc = new PushNotificationsService(
      {
        delete: del,
        findOne: jest.fn(async () => null),
        create: (x: unknown) => x,
        save: jest.fn(async (x: unknown) => x),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await svc.registerToken(
      'u2',
      'cong-1',
      'publisher' as any,
      'ExponentPushToken[shared]',
    );

    expect(del).toHaveBeenCalledTimes(1);
    const where = del.mock.calls[0][0];
    expect(where.token).toBe('ExponentPushToken[shared]');
    // Everybody's row for this token except the new owner's.
    expect(where.userId).toBeDefined();
    expect(where.userId).not.toBe('u2');
  });

  // A test is a question about ONE device. The person below has a phone AND a
  // browser; asked from the browser, the answer must come to the browser.
  describe('to the device that asked', () => {
    function device(over: { webOk?: boolean } = {}) {
      send.mockReset();
      send.mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
      const sendToSubscription = jest
        .fn()
        .mockResolvedValue(
          over.webOk === false
            ? { ok: false, errorCode: 'SendError' }
            : { ok: true, errorCode: null },
        );
      const svc = new PushNotificationsService(
        {
          findOne: jest.fn(async (q: any) =>
            q.where.token === 'ExponentPushToken[a]'
              ? { token: 'ExponentPushToken[a]', userId: 'u1' }
              : null,
          ),
        } as any,
        {} as any,
        { save: jest.fn() } as any,
        {
          getSubscriptionsByUser: jest.fn(async () => [
            { userId: 'u1', endpoint: 'https://push/ipad' },
          ]),
          sendToSubscription,
        } as any,
      );
      return { svc, sendToSubscription };
    }
    const ask = (svc: PushNotificationsService, d: any) =>
      svc.sendToDevice('cong-1', 'u1', d, 'Заголовок', 'Текст', {
        type: 'test',
      });

    it('a browser gets it even though the person has a phone', async () => {
      const { svc, sendToSubscription } = device();

      expect(await ask(svc, { endpoint: 'https://push/ipad' })).toBe('web');
      expect(sendToSubscription).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    it('the phone gets it when the phone asked', async () => {
      const { svc, sendToSubscription } = device();

      expect(await ask(svc, { token: 'ExponentPushToken[a]' })).toBe('phone');
      expect(sendToSubscription).not.toHaveBeenCalled();
    });

    it('a device the server does not know is «not registered», not «sent»', async () => {
      const { svc } = device();

      expect(await ask(svc, { endpoint: 'https://push/other' })).toBe(
        'no_device',
      );
      expect(await ask(svc, { token: 'ExponentPushToken[zzz]' })).toBe(
        'no_device',
      );
      expect(await ask(svc, {})).toBe('no_device');
    });

    it('a subscription that refuses the message is a failure', async () => {
      const { svc } = device({ webOk: false });

      expect(await ask(svc, { endpoint: 'https://push/ipad' })).toBe('failed');
    });
  });
});
