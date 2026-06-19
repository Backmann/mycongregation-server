import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

/** A user counts as "online" if seen within this window. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Minimum gap between lastSeenAt writes for a single user. A burst of requests
 * therefore costs at most one UPDATE every couple of minutes.
 */
const WRITE_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Tracks lightweight presence ("last active") for signed-in users.
 *
 * Activity is recorded by PresenceInterceptor on every authenticated request,
 * but the DB write is throttled per user (in-memory). Presence is best-effort:
 * a failed write must never affect the request that triggered it.
 */
@Injectable()
export class PresenceService {
  private readonly lastWriteAt = new Map<string, number>();

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  /** Records that `userId` was just active. Throttled and fire-and-forget. */
  touch(userId: string, now: number = Date.now()): void {
    const last = this.lastWriteAt.get(userId) ?? 0;
    if (now - last < WRITE_THROTTLE_MS) return;
    this.lastWriteAt.set(userId, now);
    void this.usersRepo
      .update(userId, { lastSeenAt: new Date(now) })
      .catch(() => undefined);
  }

  /** True when the timestamp is recent enough for the user to count as online. */
  static isOnline(lastSeenAt: Date | null, now: number = Date.now()): boolean {
    if (!lastSeenAt) return false;
    return now - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
  }
}
