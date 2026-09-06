import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { clientIp } from '../client-ip';

/**
 * Rate limiting keyed by account first, address second.
 *
 * Keying on the address alone would be wrong for this app: a whole
 * congregation shares the hall's wifi, so one busy secretary could lock
 * everyone else out. Once a request is authenticated we know exactly whose it
 * is, and the limit follows the person rather than the building.
 * Unauthenticated traffic — logins, password resets, finishing an invitation —
 * has no account yet, so it falls back to where it came from.
 *
 * And «where it came from» has to be the caller, not the reverse proxy. This
 * used to read `req.ips`, which is empty unless Express has been told to trust
 * a proxy — it had not been — and then `req.ip`, which is the nginx container:
 * one bucket for the whole congregation, on precisely the doors people were
 * queueing at. See common/client-ip.ts and the `trust proxy` line in main.ts.
 *
 * Note that login, password reset and finishing an invitation keep their own,
 * much tighter limits inside AuthService. This guard is the broad net
 * underneath everything else, not a replacement for those.
 */
@Injectable()
export class UserOrIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id as string | undefined;
    if (userId) return `user:${userId}`;
    return `ip:${clientIp(req as unknown as Request)}`;
  }
}
