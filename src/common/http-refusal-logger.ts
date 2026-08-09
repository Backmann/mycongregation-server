import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * A line in the log for every request the server refused.
 *
 * Nothing about requests was written down at all, so a question like «why do
 * I keep seeing 401 on /auth/me» could not be answered from the server —
 * only guessed at, or chased through a browser's developer tools on the one
 * machine that happened to reproduce it. That is a poor way to find anything,
 * and we spent a day on exactly that kind of chase.
 *
 * Only 4xx and 5xx: a successful request tells nobody anything, and logging
 * every one of them would bury the interesting lines and fill the disk.
 *
 * WHAT IS NOT WRITTEN, and deliberately: no request body, no query string, no
 * headers. Those carry names, notes, contacts and tokens. The path, the
 * status and the id of whoever asked are enough to find the thing, and the
 * journal is where personal changes belong.
 *
 * A note for whoever reads these lines later: a 401 on an ordinary endpoint
 * is usually not a failure. The access token lives fifteen minutes and the
 * app refreshes it three minutes before the end — but an app that was asleep
 * cannot refresh in advance, so its first request after waking is refused,
 * refreshed and repeated without the person noticing. What is worth worrying
 * about is 401s in a row with no successful /auth/refresh between them.
 */
const logger = new Logger('Http');

export function httpRefusalLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      if (res.statusCode < 400) return;
      const who =
        (req as Request & { user?: { id?: string } }).user?.id ?? 'anonymous';
      const line = `${res.statusCode} ${req.method} ${req.path} · ${who}`;
      if (res.statusCode >= 500) {
        logger.error(line);
      } else {
        logger.warn(line);
      }
    });
    next();
  };
}
