import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * Signing in with a name, an address, or the wrong half of a shared mailbox.
 *
 * The address stopped being an identity here. These hold down that the change
 * did not quietly take anything away from the people already signing in.
 */
describe('AuthService.login — name or address', () => {
  const hash = bcrypt.hashSync('right-password', 4);

  const build = (found: { user: unknown; shared: boolean }) => {
    const findForLogin = jest.fn(async () => found);
    const issued: unknown[] = [];
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.assign(service, {
      usersService: { findForLogin, touchLastLogin: jest.fn() },
      logger: { warn: jest.fn(), log: jest.fn() },
      loginAttempts: new Map<string, number[]>(),
      issueTokens: (u: unknown) => {
        issued.push(u);
        return { accessToken: 'a', refreshToken: 'r' };
      },
    });
    return { service, findForLogin, issued };
  };

  const dto = (fields: Partial<LoginDto>): LoginDto => ({
    password: 'right-password',
    ...fields,
  });

  const alive = {
    id: 'u1',
    isActive: true,
    passwordHash: hash,
    loginName: 'sidorova.vera',
  };

  it('lets a person in by login name', async () => {
    const { service, findForLogin, issued } = build({
      user: alive,
      shared: false,
    });

    await service.login(dto({ login: 'Sidorova.Vera' }));

    expect(findForLogin).toHaveBeenCalledWith('sidorova.vera');
    expect(issued).toHaveLength(1);
  });

  it('still accepts the field the app in people\u2019s pockets sends', async () => {
    // Builds already installed send { email, password }. Renaming the field on
    // the wire without accepting the old one would sign everybody out at once.
    const { service, findForLogin } = build({ user: alive, shared: false });

    await service.login(dto({ email: 'backmannleo@gmail.com' }));

    expect(findForLogin).toHaveBeenCalledWith('backmannleo@gmail.com');
  });

  it('tells a couple sharing a mailbox to use their name', async () => {
    const { service } = build({ user: null, shared: true });

    await expect(
      service.login(dto({ login: 'family@gmail.com' })),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.login(dto({ login: 'family@gmail.com' })).catch((e: unknown) => {
        throw (e as UnauthorizedException).getResponse();
      }),
    ).rejects.toEqual({ code: 'LOGIN_SHARED_EMAIL' });
  });

  it('says the same thing to a wrong password as to an unknown name', async () => {
    // The page must not become a way of finding out who has an account.
    const { service } = build({ user: null, shared: false });
    const unknown = await service
      .login(dto({ login: 'nobody.here' }))
      .catch((e: UnauthorizedException) => e.getResponse());

    const { service: s2 } = build({ user: alive, shared: false });
    const wrong = await s2
      .login(dto({ login: 'sidorova.vera', password: 'wrong-password' }))
      .catch((e: UnauthorizedException) => e.getResponse());

    expect(unknown).toEqual(wrong);
  });

  it('clears the counter it actually wrote', async () => {
    // The limiter counts under `login:id:…`; a successful sign-in used to
    // clear `login:email:…`, so the successful attempt stayed on the record
    // and counted against the next one.
    const { service } = build({ user: alive, shared: false });
    const attempts = (
      service as unknown as { loginAttempts: Map<string, number[]> }
    ).loginAttempts;

    await service.login(dto({ login: 'sidorova.vera' }), '1.2.3.4');

    expect(attempts.has('login:id:sidorova.vera')).toBe(false);
  });
});
