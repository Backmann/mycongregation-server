import { NotificationReachService } from './notification-reach.service';
import { clockStub } from '../common/testing/clock-stub';

/**
 * «Мне не приходит» — and the administrator's screen has to say why, in a
 * word that tells him what to do about it.
 */
describe('NotificationReachService.reasonFor', () => {
  const why = NotificationReachService.reasonFor;

  it('a card without a login is helped by no setting at all', () => {
    expect(
      why({ hasLogin: false, devices: 0, seen: false, pushState: null }),
    ).toBe('no_login');
  });

  it('any registered device means the person is reached', () => {
    expect(
      why({ hasLogin: true, devices: 1, seen: true, pushState: 'denied' }),
    ).toBeNull();
  });

  it('a login that never opened the app is its own case', () => {
    expect(
      why({ hasLogin: true, devices: 0, seen: false, pushState: null }),
    ).toBe('never_opened');
  });

  it('repeats what the device said about itself', () => {
    for (const s of ['not_installed', 'denied', 'off', 'unsupported']) {
      expect(
        why({ hasLogin: true, devices: 0, seen: true, pushState: s }),
      ).toBe(s);
    }
  });

  // «ok» with nothing registered is a contradiction; so is silence. Neither
  // may be dressed up as a cause.
  it('does not invent a cause it was not told', () => {
    expect(
      why({ hasLogin: true, devices: 0, seen: true, pushState: null }),
    ).toBe('unknown');
    expect(
      why({ hasLogin: true, devices: 0, seen: true, pushState: 'ok' }),
    ).toBe('unknown');
  });
});

describe('NotificationReachService.report', () => {
  function build() {
    const seen = new Date('2026-09-30T10:00:00Z');
    const publishers = [
      { id: 'p-phone', displayName: 'Бойко Виктор', userId: 'u-phone' },
      { id: 'p-ios', displayName: 'Кравец Андрей', userId: 'u-ios' },
      { id: 'p-none', displayName: 'Савчук Нина', userId: null },
      { id: 'p-web', displayName: 'Мельник Ольга', userId: 'u-web' },
    ];
    const users = [
      {
        id: 'u-phone',
        isActive: true,
        deletedAt: null,
        clientPlatform: 'android',
        clientKind: 'app',
        clientSeenAt: seen,
        pushState: 'ok',
      },
      {
        id: 'u-ios',
        isActive: true,
        deletedAt: null,
        clientPlatform: 'ios',
        clientKind: 'browser',
        clientSeenAt: seen,
        pushState: 'not_installed',
      },
      {
        id: 'u-web',
        isActive: true,
        deletedAt: null,
        clientPlatform: 'windows',
        clientKind: 'browser',
        clientSeenAt: seen,
        pushState: 'ok',
      },
    ];
    const update = jest.fn();
    const svc = new NotificationReachService(
      { find: jest.fn(async () => publishers) } as any,
      { find: jest.fn(async () => users), update } as any,
      { find: jest.fn(async () => [{ userId: 'u-phone' }]) } as any,
      { find: jest.fn(async () => [{ userId: 'u-web' }]) } as any,
      {
        find: jest.fn(async () => [
          { publisherId: 'p-ios', assistantPublisherId: null },
          { publisherId: 'p-phone', assistantPublisherId: 'p-ios' },
        ]),
      } as any,
      {
        find: jest.fn(async () => [
          {
            userId: 'u-ios',
            createdAt: new Date('2026-10-01T09:00:00Z'),
            status: 'no_device',
          },
        ]),
      } as any,
      clockStub('Europe/Berlin'),
    );
    return { svc, update };
  }

  it('counts who is reached and names why the rest are not', async () => {
    const { svc } = build();

    const r = await svc.report('cong-1');

    expect(r.total).toBe(4);
    expect(r.receiving).toBe(2);
    expect(r.unreachable).toBe(2);
    const by = Object.fromEntries(r.rows.map((x) => [x.publisherId, x]));
    expect(by['p-phone'].receives).toBe(true);
    expect(by['p-web'].browsers).toBe(1);
    expect(by['p-ios'].reason).toBe('not_installed');
    expect(by['p-none'].reason).toBe('no_login');
  });

  // The order is the order in which to go and speak to people.
  it('puts first whoever cannot be reached and has a part coming', async () => {
    const { svc } = build();

    const r = await svc.report('cong-1');

    expect(r.rows[0].publisherId).toBe('p-ios');
    // Once as the assignee, once as somebody's assistant.
    expect(r.rows[0].upcoming).toBe(2);
    expect(r.unreachableWithParts).toBe(1);
    expect(r.rows[0].lastTest?.status).toBe('no_device');
  });

  it('stores only a state from the closed list', async () => {
    const { svc, update } = build();

    await svc.reportState('u-ios', 'anything else');
    expect(update).not.toHaveBeenCalled();

    await svc.reportState('u-ios', 'denied');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1].pushState).toBe('denied');
  });
});

describe('NotificationReachService.devicesOf', () => {
  function build(tokensOf: Record<string, number>) {
    const count = jest.fn(
      async (q: { where: { userId: string } }) => tokensOf[q.where.userId] ?? 0,
    );
    const svc = new NotificationReachService(
      {} as any,
      {} as any,
      { count } as any,
      {} as any,
      {} as any,
      {} as any,
      clockStub('Europe/Berlin'),
    );
    return { svc, count };
  }

  it('says the app is there once it has registered a token', async () => {
    const { svc } = build({ 'u-phone': 1 });
    expect(await svc.devicesOf('u-phone')).toEqual({ app: true });
  });

  it('a second phone changes nothing: still one word', async () => {
    const { svc } = build({ 'u-phone': 2 });
    expect(await svc.devicesOf('u-phone')).toEqual({ app: true });
  });

  it('says it is not for somebody who only ever used the site', async () => {
    const { svc } = build({ 'u-phone': 1 });
    expect(await svc.devicesOf('u-web')).toEqual({ app: false });
  });

  // Somebody else's phone is never an answer about me.
  it('asks about the caller alone', async () => {
    const { svc, count } = build({ 'u-phone': 1 });
    await svc.devicesOf('u-web');
    expect(count).toHaveBeenCalledWith({ where: { userId: 'u-web' } });
  });
});
