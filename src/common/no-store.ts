import type { NextFunction, Request, Response } from 'express';

/**
 * Nothing the API answers is kept by a browser or a proxy (12 November 2026).
 *
 * The answers carry names, addresses and the «не посещать» list; without a
 * header a browser may keep a copy on the disk of a shared computer, where it
 * outlives the sign-out. The app never relies on the HTTP cache — it keeps
 * what it needs itself and wipes it on sign-out — so forbidding it costs
 * nothing. A route that wants something else (a calendar feed, a printed
 * page) sets its own header later, and that one stands.
 */
export function noStore() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
