import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { NotificationOutbox } from '../entities/notification-outbox.entity';
import { Publisher } from '../entities/publisher.entity';
import { PushToken } from '../entities/push-token.entity';
import { User } from '../entities/user.entity';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { CongregationClock } from '../common/congregation-clock.service';

/** What a device may say about itself. Anything else is not stored. */
export const PUSH_STATES = [
  'ok',
  'denied',
  'off',
  'not_installed',
  'unsupported',
  'no_token',
] as const;
export type PushState = (typeof PUSH_STATES)[number];

/**
 * Why a notification cannot reach somebody — in the order the remedies differ.
 *
 *   no_login      — the card has no login; no setting helps, an invitation does;
 *   never_opened  — a login that has never opened the app;
 *   not_installed — an iPhone using the site from Safari: iOS hands push only
 *                   to a site opened from the Home Screen;
 *   denied        — refused in the phone's or browser's own settings;
 *   off           — could be switched on and has not been;
 *   unsupported / no_token — the device cannot;
 *   unknown       — no device registered and the app has not said why yet.
 */
export type UnreachableReason =
  | 'no_login'
  | 'never_opened'
  | 'not_installed'
  | 'denied'
  | 'off'
  | 'unsupported'
  | 'no_token'
  | 'unknown';

export interface ReachRow {
  publisherId: string;
  displayName: string;
  hasLogin: boolean;
  receives: boolean;
  reason: UnreachableReason | null;
  /** android / ios / windows / mac / other — from the last request. */
  platform: string | null;
  /** app / browser. */
  clientKind: string | null;
  seenAt: string | null;
  phones: number;
  browsers: number;
  /** Published parts in the weeks from this one to four ahead. */
  upcoming: number;
  lastTest: { at: string; status: string } | null;
}

export interface ReachReport {
  total: number;
  receiving: number;
  unreachable: number;
  /** Unreachable AND holding a part in the coming weeks — who to speak to first. */
  unreachableWithParts: number;
  rows: ReachRow[];
}

const DAY = 24 * 60 * 60 * 1000;

function shiftDay(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * Who a notification can reach, and why not the rest.
 *
 * On 1 October 2026 a third of the people who opened the app had no device
 * registered — twelve of twenty-three on an iPhone — and the only way to learn
 * it was a query against the database. «Мне не приходит» deserves an answer an
 * administrator can read off a screen.
 */
@Injectable()
export class NotificationReachService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PushToken)
    private readonly tokens: Repository<PushToken>,
    @InjectRepository(WebPushSubscription)
    private readonly subs: Repository<WebPushSubscription>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(NotificationOutbox)
    private readonly outbox: Repository<NotificationOutbox>,
    private readonly clock: CongregationClock,
  ) {}

  /** The device's own account of itself; an unknown word is ignored. */
  async reportState(userId: string, state: string): Promise<void> {
    if (!(PUSH_STATES as readonly string[]).includes(state)) return;
    await this.users.update(
      { id: userId },
      { pushState: state, pushStateAt: new Date() },
    );
  }

  /** `full` unless the person chose the short ladder. */
  async ladderOf(userId: string): Promise<{ ladder: 'full' | 'short' }> {
    const u = await this.users.findOne({
      where: { id: userId },
      select: { id: true, reminderLadder: true },
    });
    return { ladder: u?.reminderLadder === 'short' ? 'short' : 'full' };
  }

  /** Stored only when it differs from the default — absence means «все». */
  async setLadder(
    userId: string,
    ladder: string,
  ): Promise<{ ladder: 'full' | 'short' }> {
    const short = ladder === 'short';
    await this.users.update(
      { id: userId },
      { reminderLadder: short ? 'short' : null },
    );
    return { ladder: short ? 'short' : 'full' };
  }

  static reasonFor(input: {
    hasLogin: boolean;
    devices: number;
    seen: boolean;
    pushState: string | null;
  }): UnreachableReason | null {
    if (!input.hasLogin) return 'no_login';
    if (input.devices > 0) return null;
    if (!input.seen) return 'never_opened';
    switch (input.pushState) {
      case 'not_installed':
      case 'denied':
      case 'off':
      case 'unsupported':
      case 'no_token':
        return input.pushState;
      default:
        // `ok` with no device is a contradiction the next start of the app
        // repairs; until then the honest word is that we do not know.
        return 'unknown';
    }
  }

  async report(tenantId: string): Promise<ReachReport> {
    const people = await this.publishers.find({
      where: { congregationId: tenantId, deletedAt: IsNull() },
      select: { id: true, displayName: true, userId: true },
    });
    const userIds = people
      .map((p) => p.userId)
      .filter((id): id is string => !!id);

    const [users, tokens, subs, tests] = await Promise.all([
      userIds.length
        ? this.users.find({
            where: { id: In(userIds) },
            // Only what the screen shows — never the whole row of a login.
            select: {
              id: true,
              isActive: true,
              deletedAt: true,
              clientPlatform: true,
              clientKind: true,
              clientSeenAt: true,
              pushState: true,
            },
          })
        : Promise.resolve([] as User[]),
      this.tokens.find({
        where: { congregationId: tenantId },
        select: { userId: true },
      }),
      this.subs.find({
        where: { congregationId: tenantId },
        select: { userId: true },
      }),
      this.outbox.find({
        where: { congregationId: tenantId, kind: 'test' },
        select: { userId: true, createdAt: true, status: true },
        order: { createdAt: 'DESC' },
        take: 2000,
      }),
    ]);

    const today = await this.clock.todayFor(tenantId);
    const parts = await this.assignments.find({
      where: {
        congregationId: tenantId,
        status: AssignmentStatus.PUBLISHED,
        deletedAt: IsNull(),
        // Weeks are stored by their Monday: six days back takes in the week
        // that is running now.
        weekStartDate: Between(shiftDay(today, -6), shiftDay(today, 28)),
      },
      select: { publisherId: true, assistantPublisherId: true },
    });

    const count = (list: { userId: string }[]) => {
      const m = new Map<string, number>();
      for (const x of list) m.set(x.userId, (m.get(x.userId) ?? 0) + 1);
      return m;
    };
    const phonesOf = count(tokens);
    const browsersOf = count(subs);
    const userById = new Map(users.map((u) => [u.id, u]));
    const lastTestOf = new Map<string, { at: string; status: string }>();
    for (const t of tests) {
      if (!lastTestOf.has(t.userId)) {
        lastTestOf.set(t.userId, {
          at: t.createdAt.toISOString(),
          status: t.status,
        });
      }
    }
    const upcomingOf = new Map<string, number>();
    for (const a of parts) {
      for (const id of [a.publisherId, a.assistantPublisherId]) {
        if (id) upcomingOf.set(id, (upcomingOf.get(id) ?? 0) + 1);
      }
    }

    const rows: ReachRow[] = people.map((p) => {
      const user = p.userId ? userById.get(p.userId) : undefined;
      // A login that is switched off or removed is no login for this purpose.
      const hasLogin = !!user && user.isActive && !user.deletedAt;
      const phones = hasLogin ? (phonesOf.get(user.id) ?? 0) : 0;
      const browsers = hasLogin ? (browsersOf.get(user.id) ?? 0) : 0;
      const reason = NotificationReachService.reasonFor({
        hasLogin,
        devices: phones + browsers,
        seen: !!user?.clientSeenAt,
        pushState: user?.pushState ?? null,
      });
      return {
        publisherId: p.id,
        displayName: p.displayName,
        hasLogin,
        receives: reason === null,
        reason,
        platform: user?.clientPlatform ?? null,
        clientKind: user?.clientKind ?? null,
        seenAt: user?.clientSeenAt ? user.clientSeenAt.toISOString() : null,
        phones,
        browsers,
        upcoming: upcomingOf.get(p.id) ?? 0,
        lastTest: hasLogin ? (lastTestOf.get(user.id) ?? null) : null,
      };
    });

    // Whoever cannot be reached first, and among them whoever has a part
    // coming — that is the order in which to go and speak to people.
    rows.sort(
      (a, b) =>
        Number(a.receives) - Number(b.receives) ||
        b.upcoming - a.upcoming ||
        a.displayName.localeCompare(b.displayName, 'ru'),
    );

    const unreachable = rows.filter((r) => !r.receives);
    return {
      total: rows.length,
      receiving: rows.length - unreachable.length,
      unreachable: unreachable.length,
      unreachableWithParts: unreachable.filter((r) => r.upcoming > 0).length,
      rows,
    };
  }
}
