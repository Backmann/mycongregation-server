import type { Request, Response } from 'express';
import {
  AUTH_MODE_HEADER,
  REFRESH_COOKIE,
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
  wantsCookieAuth,
} from './refresh-cookie';

const reqWith = (
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
) =>
  ({
    header: (name: string) => headers[name.toLowerCase()],
    cookies,
  }) as unknown as Request;

const fakeRes = () => {
  const calls: { set: any[]; cleared: any[] } = { set: [], cleared: [] };
  const res = {
    cookie: (name: string, value: string, opts: any) =>
      calls.set.push({ name, value, opts }),
    clearCookie: (name: string, opts: any) =>
      calls.cleared.push({ name, opts }),
  } as unknown as Response;
  return { res, calls };
};

describe('refresh cookie', () => {
  describe('mode detection', () => {
    it('turns on only when the client asks for it', () => {
      expect(wantsCookieAuth(reqWith({ [AUTH_MODE_HEADER]: 'cookie' }))).toBe(
        true,
      );
      expect(wantsCookieAuth(reqWith({ [AUTH_MODE_HEADER]: 'COOKIE' }))).toBe(
        true,
      );
    });

    it('stays off for a client that says nothing — native keeps its old flow', () => {
      expect(wantsCookieAuth(reqWith())).toBe(false);
      expect(wantsCookieAuth(reqWith({ [AUTH_MODE_HEADER]: 'bearer' }))).toBe(
        false,
      );
    });
  });

  describe('where the token is read from', () => {
    it('prefers the cookie a browser sends by itself', () => {
      const req = reqWith({}, { [REFRESH_COOKIE]: 'from-cookie' });
      expect(readRefreshToken(req, 'from-body')).toBe('from-cookie');
    });

    it('falls back to the body, so already-signed-in clients survive the change', () => {
      expect(readRefreshToken(reqWith(), 'from-body')).toBe('from-body');
    });

    it('returns nothing when neither is present', () => {
      expect(readRefreshToken(reqWith())).toBeUndefined();
      expect(
        readRefreshToken(reqWith({}, { [REFRESH_COOKIE]: '' })),
      ).toBeUndefined();
    });
  });

  describe('the attributes that do the protecting', () => {
    it('is unreachable from scripts and fenced against other sites', () => {
      const { res, calls } = fakeRes();
      setRefreshCookie(res, 'tok', {
        apiPrefix: 'api',
        isProduction: true,
        maxAgeMs: 1000,
      });

      const { opts, value, name } = calls.set[0];
      expect(name).toBe(REFRESH_COOKIE);
      expect(value).toBe('tok');
      // No script can read it — this is the whole point.
      expect(opts.httpOnly).toBe(true);
      // A request coming from another site does not carry it.
      expect(opts.sameSite).toBe('lax');
      // HTTPS only in production.
      expect(opts.secure).toBe(true);
      // Attached to the auth endpoints and nothing else.
      expect(opts.path).toBe('/api/auth');
      expect(opts.maxAge).toBe(1000);
    });

    it('drops the Secure flag outside production, or local http would lose it', () => {
      const { res, calls } = fakeRes();
      setRefreshCookie(res, 'tok', {
        apiPrefix: 'api',
        isProduction: false,
        maxAgeMs: 1000,
      });
      expect(calls.set[0].opts.secure).toBe(false);
    });

    it('follows a non-default api prefix', () => {
      const { res, calls } = fakeRes();
      setRefreshCookie(res, 'tok', {
        apiPrefix: 'v2',
        isProduction: true,
        maxAgeMs: 1,
      });
      expect(calls.set[0].opts.path).toBe('/v2/auth');
    });

    it('clears with the same attributes, or the browser keeps the old cookie', () => {
      const { res, calls } = fakeRes();
      setRefreshCookie(res, 'tok', {
        apiPrefix: 'api',
        isProduction: true,
        maxAgeMs: 1000,
      });
      clearRefreshCookie(res, { apiPrefix: 'api', isProduction: true });

      const set = calls.set[0].opts;
      const cleared = calls.cleared[0].opts;
      expect(cleared.path).toBe(set.path);
      expect(cleared.sameSite).toBe(set.sameSite);
      expect(cleared.secure).toBe(set.secure);
      expect(cleared.httpOnly).toBe(set.httpOnly);
    });
  });
});
