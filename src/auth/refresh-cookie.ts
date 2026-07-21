import type { CookieOptions, Request, Response } from 'express';

/**
 * The refresh token as an httpOnly cookie, for browsers only.
 *
 * WHY
 * The refresh token is the real key to an account: it lives 30 days and can
 * mint access tokens the whole time. Kept in localStorage it is one line of
 * script away from any XSS on the site, and stealing it means owning the
 * account for a month. In an httpOnly cookie it is unreachable from
 * JavaScript — document.cookie does not show it and nothing can read it back.
 *
 * The access token deliberately stays OUT of cookies and travels in the
 * Authorization header as before. That is not an oversight, it is what keeps
 * this design safe from CSRF: a page on another site can make the browser send
 * a request, but it cannot set a header. So every data endpoint stays
 * unreachable to a forged cross-site request, because none of them read the
 * cookie. Only refresh and logout do, and they are fenced in by the attributes
 * below.
 *
 * Native apps do not use any of this: expo-secure-store puts the token in the
 * Keychain/Keystore, which is stronger than a cookie jar. They keep sending
 * the token in the request body, which is why every reader here falls back to
 * the body.
 */
export const REFRESH_COOKIE = 'mc_rt';

/**
 * Web clients ask for cookie mode explicitly with this header. Sniffing the
 * Origin would be guesswork; an explicit signal means the server never has to
 * infer what kind of client it is talking to.
 */
export const AUTH_MODE_HEADER = 'x-auth-mode';

export function wantsCookieAuth(req: Request): boolean {
  return req.header(AUTH_MODE_HEADER)?.toLowerCase() === 'cookie';
}

function options(apiPrefix: string, isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    // Only over HTTPS in production; plain http locally would drop the cookie.
    secure: isProduction,
    // The app and the API sit on the same registrable domain
    // (mycongregation.org / api.mycongregation.org), so requests between them
    // count as same-site and the cookie travels. A request originating from
    // any other site does not carry it — that is the CSRF fence.
    sameSite: 'lax',
    // Narrow the blast radius: the cookie is attached to the auth endpoints
    // and to nothing else in the API.
    path: `/${apiPrefix}/auth`,
  };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  opts: { apiPrefix: string; isProduction: boolean; maxAgeMs: number },
): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...options(opts.apiPrefix, opts.isProduction),
    maxAge: opts.maxAgeMs,
  });
}

export function clearRefreshCookie(
  res: Response,
  opts: { apiPrefix: string; isProduction: boolean },
): void {
  // Attributes must match the ones the cookie was set with, or the browser
  // keeps the original and the sign-out silently fails to remove it.
  res.clearCookie(REFRESH_COOKIE, options(opts.apiPrefix, opts.isProduction));
}

/**
 * Where a refresh token may come from, in order: the cookie a browser sends by
 * itself, then the request body a native client sends by hand. Accepting both
 * is what lets already-signed-in people keep their session across this change
 * instead of being thrown back to the login screen.
 */
export function readRefreshToken(
  req: Request,
  bodyToken?: string,
): string | undefined {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[
    REFRESH_COOKIE
  ];
  return fromCookie || bodyToken || undefined;
}
