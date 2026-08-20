import { BadRequestException, HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Finishing an invitation with the code and nothing else.
 *
 * The address used to be required here — only to find the account, before the
 * code was checked against it. That made this door useless to the forty-four
 * people who have no address at all, which is precisely who it was built for.
 */
describe('AuthService.redeemInvite — the code says who this is', () => {
  const HOUR = 60 * 60 * 1000;

  const build = (user: unknown) => {
    const findByInviteCode = jest.fn(async () => user);
    const completeInvite = jest.fn(async () => undefined);
    const issued: unknown[] = [];
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.assign(service, {
      usersService: {
        findByInviteCode,
        completeInvite,
        // Setting a password by code ends the account's other sessions — the
        // lost phone must not keep the way in it already had.
        revokeAllSessions: jest.fn(),
      },
      config: { get: () => 4 },
      logger: { warn: jest.fn(), log: jest.fn() },
      loginAttempts: new Map<string, number[]>(),
      inviteAttempts: new Map<string, number[]>(),
      issueTokens: (u: unknown) => {
        issued.push(u);
        return { accessToken: 'a', refreshToken: 'r' };
      },
    });
    return { service, findByInviteCode, completeInvite, issued };
  };

  const waiting = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    loginName: 'sidorova.vera',
    email: null,
    isActive: true,
    inviteCodeExpiresAt: new Date(Date.now() + HOUR),
    ...over,
  });

  it('lets in an account that has no address at all', async () => {
    const { service, completeInvite, issued } = build(waiting());

    await service.redeemInvite('k7qm-3xpd', 'correct horse battery');

    expect(completeInvite).toHaveBeenCalled();
    expect(issued).toHaveLength(1);
  });

  it('forgives the case and the hyphen the reader typed', async () => {
    const { service, findByInviteCode } = build(waiting());

    await service.redeemInvite('  k7qm 3xpd ', 'correct horse battery');

    expect(findByInviteCode).toHaveBeenCalledWith('K7QM3XPD');
  });

  it('says the same thing to a wrong code as to an expired one', async () => {
    // A refusal that told them apart would say whether a code exists, and a
    // code is the whole secret here.
    const wrong = await build(null)
      .service.redeemInvite('ZZZZ-ZZZZ', 'correct horse battery')
      .catch((e: BadRequestException) => e.getResponse());

    const expired = await build(
      waiting({ inviteCodeExpiresAt: new Date(Date.now() - HOUR) }),
    )
      .service.redeemInvite('K7QM-3XPD', 'correct horse battery')
      .catch((e: BadRequestException) => e.getResponse());

    expect(wrong).toEqual({ code: 'INVITE_INVALID' });
    expect(expired).toEqual(wrong);
  });

  it('judges the password before it spends the code', async () => {
    // A weak password should cost another try at typing, not the invitation.
    const { service, completeInvite } = build(waiting());

    await expect(service.redeemInvite('K7QM-3XPD', 'short')).rejects.toThrow(
      BadRequestException,
    );
    expect(completeInvite).not.toHaveBeenCalled();
  });

  it('stops one address guessing codes all afternoon', async () => {
    // Nothing counts attempts per account any more — a wrong code belongs to
    // no account — so this limit is the only thing standing in the way.
    const { service } = build(null);
    for (let i = 0; i < 10; i++) {
      await service
        .redeemInvite('ZZZZ-ZZZZ', 'correct horse battery', '5.6.7.8')
        .catch(() => undefined);
    }

    await expect(
      service.redeemInvite('ZZZZ-ZZZZ', 'correct horse battery', '5.6.7.8'),
    ).rejects.toThrow(HttpException);
  });

  it('does not ask the account for its address at any point', async () => {
    // The whole point: an account with email null goes through untouched. App
    // builds already installed still SEND an address — the request shape still
    // accepts it, and the controller drops it before this method sees it.
    const { service, completeInvite } = build(waiting({ email: null }));

    await service.redeemInvite('K7QM-3XPD', 'correct horse battery', '1.2.3.4');

    expect(completeInvite).toHaveBeenCalledWith('u1', expect.any(String));
  });
});
