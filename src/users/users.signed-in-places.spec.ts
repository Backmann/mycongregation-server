import { UsersService } from './users.service';

/**
 * «Где вы вошли» — the list a person and the elder helping them both read.
 *
 * A sign-in is a chain of session rows, one replaced by the next at every
 * renewal. What matters is told from two of them: the newest says the chain is
 * alive and when it last renewed, the first says when the person signed in.
 */
describe('UsersService.signedInPlaces', () => {
  const at = (iso: string) => new Date(iso);
  const FAR = at('2099-01-01T00:00:00Z');

  const build = (
    alive: Record<string, unknown>[],
    firsts: { familyId: string; since: string }[] = [],
  ) => {
    const find = jest.fn(async () => alive);
    const getRawMany = jest.fn(async () => firsts);
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      sessionsRepo: {
        find,
        createQueryBuilder: () => ({
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany,
        }),
      },
    });
    return { service, find, getRawMany };
  };

  const row = (over: Record<string, unknown>) => ({
    familyId: 'f1',
    createdAt: at('2026-10-07T08:00:00Z'),
    expiresAt: FAR,
    revokedAt: null,
    clientPlatform: 'android',
    clientKind: 'app',
    clientOs: '34',
    clientAppVersion: '1.1.0',
    ...over,
  });

  it('asks only for sessions that are alive', async () => {
    const { service, find } = build([]);

    await service.signedInPlaces('u1');

    const where = (find.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(Object.keys(where.where).sort()).toEqual([
      'expiresAt',
      'revokedAt',
      'userId',
    ]);
  });

  it('nobody signed in anywhere is an empty list, and nothing further is asked', async () => {
    const { service, getRawMany } = build([]);

    expect(await service.signedInPlaces('u1')).toEqual([]);
    expect(getRawMany).not.toHaveBeenCalled();
  });

  it('one row per place: when they signed in, and when it was last renewed', async () => {
    const { service } = build(
      [row({})],
      [{ familyId: 'f1', since: '2026-09-01T10:00:00Z' }],
    );

    expect(await service.signedInPlaces('u1')).toEqual([
      {
        platform: 'android',
        kind: 'app',
        os: '34',
        appVersion: '1.1.0',
        since: at('2026-09-01T10:00:00Z'),
        lastActiveAt: at('2026-10-07T08:00:00Z'),
        current: false,
      },
    ]);
  });

  it('two living rows of one chain are one place — the newer speaks', async () => {
    // A reply lost on the way leaves the old row unrevoked for a moment.
    const { service } = build([
      row({ createdAt: at('2026-10-07T09:00:00Z') }),
      row({ createdAt: at('2026-10-07T08:00:00Z') }),
    ]);

    const places = await service.signedInPlaces('u1');

    expect(places).toHaveLength(1);
    expect(places[0].lastActiveAt).toEqual(at('2026-10-07T09:00:00Z'));
  });

  it('«это устройство» comes first, then the most recently used', async () => {
    const { service } = build([
      row({
        familyId: 'desk',
        clientPlatform: 'windows',
        clientKind: 'browser',
        createdAt: at('2026-10-07T09:00:00Z'),
      }),
      row({ familyId: 'phone', createdAt: at('2026-10-06T09:00:00Z') }),
      row({
        familyId: 'icon',
        clientPlatform: 'ios',
        clientKind: 'homescreen',
        createdAt: at('2026-10-01T09:00:00Z'),
      }),
    ]);

    const places = await service.signedInPlaces('u1', 'icon');

    expect(places.map((p) => [p.platform, p.kind, p.current])).toEqual([
      ['ios', 'homescreen', true],
      ['windows', 'browser', false],
      ['android', 'app', false],
    ]);
  });

  it('marks nothing when the token is too old to say which sign-in it is', async () => {
    const { service } = build([row({})]);

    const places = await service.signedInPlaces('u1', undefined);

    expect(places[0].current).toBe(false);
  });
});
