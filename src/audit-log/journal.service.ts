import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, LessThan, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';

export interface JournalPerson {
  id: string;
  name: string | null;
}

export interface JournalEntry {
  id: string;
  occurredAt: string;
  action: string;
  /** 'user' or 'system' — see the source column on the entity. */
  source: string;
  entityType: string;
  entityId: string;
  actor: JournalPerson | null;
  subject: JournalPerson | null;
  changedFields: string[];
  /**
   * Values as they were before the change. Present for edits recorded through
   * logUpdate; null for events that have no previous state. Without this the
   * journal can only say what a field became, never what it was — so
   * "replaced Peter with Andrew" was unsayable.
   */
  before: Record<string, unknown> | null;
  /** Free-form facts for events that have no before/after. */
  detail: Record<string, unknown> | null;
  /** True when the values were cleared at the subject's request. */
  redacted: boolean;
}

export interface JournalPage {
  items: JournalEntry[];
  nextCursor: string | null;
  /**
   * Every id mentioned anywhere on this page that could be resolved, mapped to
   * a readable name. Values inside before/after are bare ids — a publisher id
   * says nothing to a reader — and resolving them here keeps the entry itself
   * unmangled while letting the screen show names.
   */
  names: Record<string, string>;
}

export interface JournalFilters {
  limit?: number;
  /** ISO timestamp; returns entries strictly older than this. */
  before?: string;
  entityType?: string;
  actorUserId?: string;
  personId?: string;
  action?: string;
  from?: string;
  to?: string;
}

/**
 * Reading the journal, for administrators.
 *
 * Deliberately separate from the activity feed. That feed answers a narrower
 * question for elders — who changed a publisher's status, who submitted which
 * report — and its shape says so: it carries reportMonth and oldStatus fields
 * and a sentence built on the server. The journal has to carry assignments,
 * duties, cleaning, settings, views, downloads and refusals, and it will carry
 * more later; bending the feed to that would leave neither doing its job well.
 *
 * The sentence is NOT built here. The app speaks three languages, and a
 * journal that only speaks Russian would be the one screen that does. What
 * goes over the wire is what happened; how to say it belongs where the
 * translations live.
 */
@Injectable()
export class JournalService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
  ) {}

  async find(tenantId: string, filters: JournalFilters): Promise<JournalPage> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

    const where: FindOptionsWhere<AuditLog> = { congregationId: tenantId };
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters.action) where.action = filters.action;

    // A cursor and a date range both narrow createdAt, so they have to be
    // combined rather than each overwriting the other.
    const upper = filters.before
      ? new Date(filters.before)
      : filters.to
        ? new Date(filters.to)
        : null;
    if (filters.from && upper) {
      where.createdAt = Between(new Date(filters.from), upper);
    } else if (filters.from) {
      where.createdAt = Between(
        new Date(filters.from),
        new Date(8640000000000000),
      );
    } else if (upper) {
      where.createdAt = LessThan(upper);
    }

    // "Everything touching this person" means either they did it or it was
    // about them — two columns, so two conditions.
    const conditions: FindOptionsWhere<AuditLog>[] = filters.personId
      ? [
          { ...where, subjectId: filters.personId },
          { ...where, entityId: filters.personId },
        ]
      : [where];

    const rows = await this.auditRepo.find({
      where: conditions,
      order: { createdAt: 'DESC' },
      // One extra tells us whether another page exists without a count query.
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? page[page.length - 1].createdAt.toISOString()
        : null;

    const names = await this.namesFor(tenantId, page);

    return {
      items: page.map((row) => ({
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        action: row.action,
        source: row.source,
        entityType: row.entityType,
        entityId: row.entityId,
        actor: row.actorUserId
          ? { id: row.actorUserId, name: names.get(row.actorUserId) ?? null }
          : null,
        subject: row.subjectId
          ? { id: row.subjectId, name: names.get(row.subjectId) ?? null }
          : null,
        changedFields: row.changedFields ?? [],
        before: parseDetail(row.beforeJson),
        detail: parseDetail(row.afterJson),
        redacted: row.redactedAt !== null,
      })),
      nextCursor,
      names: Object.fromEntries(names),
    };
  }

  /**
   * Names for everyone mentioned on the page, in two queries rather than two
   * per row. Ids may be users or publishers depending on what was recorded,
   * so both are looked up and merged.
   */
  private async namesFor(
    tenantId: string,
    rows: AuditLog[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.actorUserId) ids.add(row.actorUserId);
      if (row.subjectId) ids.add(row.subjectId);
      // Ids also hide INSIDE the recorded values: a swapped microphone reads
      // as publisherId "old-uuid" → "new-uuid", and neither means anything to
      // a reader. Collect them too so both sides of a change can be named.
      collectIds(row.beforeJson, ids);
      collectIds(row.afterJson, ids);
    }
    if (ids.size === 0) return new Map();

    const wanted = [...ids];
    // An id here may be a user account or a publisher card, depending on what
    // was recorded, and a user account carries no name of its own — the name
    // lives on the publisher linked to it. So both are looked up: by publisher
    // id, and by the user id a publisher belongs to.
    const [byId, byUserId, users] = await Promise.all([
      this.publishersRepo.find({
        where: { congregationId: tenantId, id: In(wanted) },
      }),
      this.publishersRepo.find({
        where: { congregationId: tenantId, userId: In(wanted) },
      }),
      this.usersRepo.find({
        where: { congregationId: tenantId, id: In(wanted) },
      }),
    ]);

    const names = new Map<string, string>();
    const fullName = (p: Publisher) =>
      [p.lastName, p.firstName].filter(Boolean).join(' ').trim();

    // Email last: a name is better, but an address beats a bare id when the
    // account has no card behind it.
    for (const u of users) if (u.email) names.set(u.id, u.email);
    for (const p of byUserId) {
      const name = fullName(p);
      if (name && p.userId) names.set(p.userId, name);
    }
    for (const p of byId) {
      const name = fullName(p);
      if (name) names.set(p.id, name);
    }
    return names;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pull every id-looking string out of a recorded value map, at any depth, so
 * the values inside a change can be given names alongside the actor.
 */
function collectIds(json: string | null, into: Set<string>): void {
  if (!json) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (UUID_RE.test(v)) into.add(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      for (const item of Object.values(v)) walk(item);
    }
  };
  walk(parsed);
}

function parseDetail(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
