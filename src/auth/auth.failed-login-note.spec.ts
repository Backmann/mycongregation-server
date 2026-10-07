import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

/**
 * Why somebody was turned away is remembered on their account — for the
 * elder who will be asked to help.
 *
 * The page says one sentence for every refusal, on purpose. The reason went
 * to the server log, and the log starts again at every deploy: on 7 October
 * a sister could not get in, three deploys had happened overnight, and there
 * was nothing left to read.
 */
describe('a refusal at the door is remembered on the account', () => {
  const hash = bcrypt.hashSync('right-password', 4);

  const build = (user: unknown) => {
    const noteFailedLogin = jest.fn();
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.assign(service, {
      usersService: {
        findForLogin: jest.fn(async () => ({ user, shared: false })),
        findByInviteCode: jest.fn(async () => user),
        touchLastLogin: jest.fn(),
        noteFailedLogin,
      },
      logger: { warn: jest.fn(), log: jest.fn() },
      loginAttempts: new Map<string, number[]>(),
      issueTokens: () => ({ accessToken: 'a', refreshToken: 'r' }),
    });
    return { service, noteFailedLogin };
  };
  const tryIn = (service: AuthService, password = 'right-password') =>
    service.login({ login: 'sidorova.vera', password }).catch(() => undefined);

  it.each([
    [
      'wrong_password',
      { id: 'u1', isActive: true, passwordHash: hash },
      'wrong one',
    ],
    [
      'no_password',
      { id: 'u1', isActive: true, passwordHash: null },
      'right-password',
    ],
    [
      'disabled',
      { id: 'u1', isActive: false, passwordHash: hash },
      'right-password',
    ],
  ])('%s', async (reason, user, password) => {
    const { service, noteFailedLogin } = build(user);
    await tryIn(service, password);
    expect(noteFailedLogin).toHaveBeenCalledWith('u1', reason);
  });

  it('a name nobody holds belongs to no account — nothing is written anywhere', async () => {
    const { service, noteFailedLogin } = build(null);
    await tryIn(service);
    expect(noteFailedLogin).not.toHaveBeenCalled();
  });

  it('getting in writes no refusal', async () => {
    const { service, noteFailedLogin } = build({
      id: 'u1',
      isActive: true,
      passwordHash: hash,
    });
    await tryIn(service);
    expect(noteFailedLogin).not.toHaveBeenCalled();
  });

  it('a code that has run out is remembered too', async () => {
    const { service, noteFailedLogin } = build({
      id: 'u1',
      isActive: true,
      inviteCodeExpiresAt: new Date(Date.now() - 1000),
    });
    await service
      .redeemInvite('K7QM-3XPD', 'Birke Nebel Tasse')
      .catch(() => undefined);
    expect(noteFailedLogin).toHaveBeenCalledWith('u1', 'code_expired');
  });
});

describe('UsersService.lastFailedLogin — what the card is told', () => {
  const build = (row: unknown) => {
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: {
        createQueryBuilder: () => ({
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () => row),
        }),
      },
    });
    return service;
  };
  const at = (iso: string) => new Date(iso);

  it('a refusal after the last time he got in is told, with its reason', async () => {
    const res = await build({
      lastLoginAt: at('2026-10-01T10:00:00Z'),
      lastFailedLoginAt: at('2026-10-06T13:12:00Z'),
      lastFailedLoginReason: 'wrong_password',
    }).lastFailedLogin('u1');
    expect(res).toEqual({
      at: at('2026-10-06T13:12:00Z'),
      reason: 'wrong_password',
    });
  });

  it('somebody who has never got in: the refusal is told', async () => {
    const res = await build({
      lastLoginAt: null,
      lastFailedLoginAt: at('2026-10-06T13:12:00Z'),
      lastFailedLoginReason: 'no_password',
    }).lastFailedLogin('u1');
    expect(res?.reason).toBe('no_password');
  });

  it('a refusal BEFORE he got in says nothing about today', async () => {
    const res = await build({
      lastLoginAt: at('2026-10-07T08:00:00Z'),
      lastFailedLoginAt: at('2026-10-06T13:12:00Z'),
      lastFailedLoginReason: 'wrong_password',
    }).lastFailedLogin('u1');
    expect(res).toBeNull();
  });

  it('no refusal on record: null', async () => {
    expect(await build({ lastLoginAt: null }).lastFailedLogin('u1')).toBeNull();
  });
});
