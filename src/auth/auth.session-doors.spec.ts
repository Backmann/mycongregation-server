import { readFileSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AUTH_MODE_HEADER, REFRESH_COOKIE } from './refresh-cookie';

/**
 * Every door that hands out a session hands it out the same way.
 *
 * FOUND ON THE STAND, 7 OCTOBER 2026. Signing in set the cookie a browser
 * lives on; finishing an invitation by code and setting a password by link did
 * not — they answered with the tokens in the body, which a browser throws
 * away. On the website a newcomer typed the code, was let in, closed the page
 * and was asked for a name and a password he had seen for ten seconds. The
 * phone app was never affected, which is why nobody at a desk saw it.
 */
describe('AuthController — the doors that hand out a session', () => {
  const tokens = {
    accessToken: 'access',
    refreshToken: 'refresh-token',
    user: { id: 'u1' },
  };

  const build = () => {
    const authService = {
      login: jest.fn(async () => tokens),
      refresh: jest.fn(async () => tokens),
      resetPassword: jest.fn(async () => tokens),
      redeemInvite: jest.fn(async () => tokens),
    };
    const controller = new AuthController(
      authService as never,
      {} as never,
      { get: () => undefined } as never,
    );
    return { controller, authService };
  };

  const browser = () =>
    ({
      header: (name: string) =>
        name.toLowerCase() === AUTH_MODE_HEADER ? 'cookie' : undefined,
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)' },
      cookies: { [REFRESH_COOKIE]: 'old' },
      ip: '203.0.113.7',
      socket: {},
    }) as unknown as Request;

  const phone = () =>
    ({
      header: () => undefined,
      headers: {
        'user-agent': 'okhttp/4.12.0',
        'x-client': 'platform=android; kind=app; os=34; app=1.1.0',
      },
      cookies: {},
      ip: '203.0.113.8',
      socket: {},
    }) as unknown as Request;

  const response = () => {
    const set: { name: string; value: string }[] = [];
    const res = {
      cookie: (name: string, value: string) => set.push({ name, value }),
      clearCookie: jest.fn(),
    } as unknown as Response;
    return { res, set };
  };

  const doors: [
    string,
    (c: AuthController, req: Request, res: Response) => Promise<unknown>,
  ][] = [
    [
      'signing in',
      (c, req, res) =>
        c.login({ login: 'vera', password: 'x' } as never, req, res),
    ],
    [
      'a session renewing itself',
      (c, req, res) => c.refresh({ refreshToken: 'old' }, req, res),
    ],
    [
      'a password set by link',
      (c, req, res) =>
        c.resetPassword({ token: 't', password: 'x' } as never, req, res),
    ],
    [
      'an invitation finished by code',
      (c, req, res) =>
        c.redeemInvite({ code: 'ABCD2345', password: 'x' } as never, req, res),
    ],
  ];

  it.each(doors)(
    '%s: a browser gets the cookie, and the token stays out of the body',
    async (_name, open) => {
      const { controller } = build();
      const { res, set } = response();

      const body = await open(controller, browser(), res);

      expect(set).toEqual([{ name: REFRESH_COOKIE, value: 'refresh-token' }]);
      expect(body).not.toHaveProperty('refreshToken');
      expect(body).toHaveProperty('accessToken', 'access');
    },
  );

  it.each(doors)(
    '%s: the phone app keeps getting the token itself',
    async (_name, open) => {
      const { controller } = build();
      const { res, set } = response();

      const body = await open(controller, phone(), res);

      expect(set).toEqual([]);
      expect(body).toHaveProperty('refreshToken', 'refresh-token');
    },
  );

  it('the two doors that used to forget it say what the session is used from', async () => {
    // Both passed nothing, so a session begun by code read «неизвестно» in
    // every list that says where somebody is signed in.
    const { controller, authService } = build();

    await controller.resetPassword(
      { token: 't', password: 'x' } as never,
      phone(),
      response().res,
    );
    await controller.redeemInvite(
      { code: 'ABCD2345', password: 'x' } as never,
      phone(),
      response().res,
    );

    const android = expect.objectContaining({
      platform: 'android',
      kind: 'app',
    });
    expect(authService.resetPassword.mock.calls[0]).toEqual([
      't',
      'x',
      android,
    ]);
    expect(authService.redeemInvite.mock.calls[0]).toEqual([
      'ABCD2345',
      'x',
      '203.0.113.8',
      android,
    ]);
  });

  it('no handler returns what the service gave it without passing it through', () => {
    // The net for the NEXT door somebody adds: whatever the service returns
    // from these calls carries a refresh token, and returning it straight is
    // how the two above went wrong.
    const source = readFileSync(join(__dirname, 'auth.controller.ts'), 'utf8');
    const straight = source.match(
      /return this\.authService\.(login|refresh|resetPassword|redeemInvite)\(/g,
    );
    expect(straight).toBeNull();
  });
});
