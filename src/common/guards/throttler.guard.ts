import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting keyed by account first, IP second.
 *
 * Keying on IP alone would be wrong for this app: a whole congregation shares
 * the hall's wifi, so one busy secretary could lock everyone else out. Once a
 * request is authenticated we know exactly whose it is, and the limit follows
 * the person rather than the building. Unauthenticated traffic — logins,
 * password resets, the health check — has no account yet, so it falls back to
 * the address it came from.
 *
 * Note that login and password reset keep their own, much tighter limits
 * inside AuthService (6 attempts / 15 min, 3 mails / hour). This guard is the
 * broad net underneath everything else, not a replacement for those.
 */
@Injectable()
export class UserOrIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id as string | undefined;
    if (userId) return `user:${userId}`;
    const ip =
      (req.ips as string[] | undefined)?.[0] ??
      (req.ip as string | undefined) ??
      'unknown';
    return `ip:${ip}`;
  }
}
