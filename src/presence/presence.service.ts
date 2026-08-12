import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import type { ClientInfo } from '../auth/read-client';

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
  /** Last client seen per user, so a change can skip the throttle. */
  private readonly lastClient = new Map<string, string>();

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  /**
   * Records that `userId` was just active, and what he is using.
   *
   * The client travels with the presence stamp because it is the same kind of
   * fact and changes on the same occasions. It used to be written only when a
   * session was created — at sign-in or on a token refresh — so a brother who
   * had just installed the new build went on reading «Неизвестно» until
   * something happened to create a session. Here it is right within a minute
   * of him opening the app.
   *
   * Throttled and fire-and-forget, exactly as before: a failed write must
   * never disturb the request that triggered it. But a CHANGE of client skips
   * the throttle — that is the moment worth recording promptly, and it happens
   * about as often as somebody changes phones.
   */
  touch(userId: string, now: number = Date.now(), client?: ClientInfo): void {
    const last = this.lastWriteAt.get(userId) ?? 0;
    const known = this.lastClient.get(userId);
    const signature = client
      ? `${client.platform}|${client.kind}|${client.os ?? ''}|${client.appVersion ?? ''}`
      : null;
    const changed = !!signature && signature !== known;

    if (!changed && now - last < WRITE_THROTTLE_MS) return;
    this.lastWriteAt.set(userId, now);
    if (signature) this.lastClient.set(userId, signature);

    void this.usersRepo
      .update(userId, {
        lastSeenAt: new Date(now),
        ...(client
          ? {
              clientPlatform: client.platform,
              clientKind: client.kind,
              clientOs: client.os,
              clientAppVersion: client.appVersion,
              clientSeenAt: new Date(now),
            }
          : {}),
      })
      .catch(() => undefined);
  }

  /** True when the timestamp is recent enough for the user to count as online. */
  static isOnline(lastSeenAt: Date | null, now: number = Date.now()): boolean {
    if (!lastSeenAt) return false;
    return now - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
  }
}
