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
    const sendToSubscription = jest.fn().mockResolvedValue(undefined);
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
});
