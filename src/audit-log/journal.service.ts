import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, LessThan, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';

export interface JournalPerson {
  id: string;
  name: string | null;
}

/**
 * What a journal entry is ABOUT, beyond the values that changed: which meeting,
 * which date, which part. "Assigned to: Peter → Andrew" is only half an answer
 * without it — assigned to what?
 *
 * Resolved centrally from the entity id rather than threaded through the twenty
 * places that write entries, for the same reason the acting user travels in a
 * request context: one missed call site would silently record nothing, and
 * nothing is exactly what this is meant to stop.
 */
export interface JournalContext {
  /** ISO date — the week the item belongs to, or the meeting's own date. */
  date?: string;
  /** 'midweek' | 'weekend', where the item belongs to a meeting. */
  eventType?: string;
  /** A key the app already translates: part key, duty type, cleaning slot. */
  kind?: string;
  /** Free text that is already human: a part title, a label, an address. */
  title?: string;
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
  /** Which item this entry concerns; null when it cannot be resolved. */
  context: JournalContext | null;
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
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(Duty)
    private readonly dutiesRepo: Repository<Duty>,
    @InjectRepository(CleaningAssignment)
    private readonly cleaningRepo: Repository<CleaningAssignment>,
    @InjectRepository(FieldServiceMeeting)
    private readonly fieldServiceRepo: Repository<FieldServiceMeeting>,
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
    const contexts = await this.contextsFor(tenantId, page);

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
        context: contexts.get(row.id) ?? null,
      })),
      nextCursor,
      names: Object.fromEntries(names),
    };
  }

  /**
   * "Which one" for every entry on the page, in one query per entity type
   * rather than one per row. Entries whose item has since been deleted simply
   * get no context — their DELETE entry already carries the identifying facts
   * in its detail, so nothing is lost.
   *
   * Every lookup is scoped by congregation, like everything else here.
   */
  private async contextsFor(
    tenantId: string,
    rows: AuditLog[],
  ): Promise<Map<string, JournalContext>> {
    const byType = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = byType.get(row.entityType) ?? new Set<string>();
      set.add(row.entityId);
      byType.set(row.entityType, set);
    }
    const out = new Map<string, JournalContext>();
    const idsOf = (t: string) => [...(byType.get(t) ?? [])];

    const [assignments, duties, cleaning, fieldService] = await Promise.all([
      idsOf('assignment').length
        ? this.assignmentsRepo.find({
            where: { congregationId: tenantId, id: In(idsOf('assignment')) },
          })
        : Promise.resolve([]),
      idsOf('duty').length
        ? this.dutiesRepo.find({
            where: { congregationId: tenantId, id: In(idsOf('duty')) },
          })
        : Promise.resolve([]),
      idsOf('cleaning').length
        ? this.cleaningRepo.find({
            where: { congregationId: tenantId, id: In(idsOf('cleaning')) },
          })
        : Promise.resolve([]),
      idsOf('field_service_meeting').length
        ? this.fieldServiceRepo.find({
            where: {
              congregationId: tenantId,
              id: In(idsOf('field_service_meeting')),
            },
          })
        : Promise.resolve([]),
    ]);

    const perEntity = new Map<string, JournalContext>();
    for (const a of assignments) {
      perEntity.set(a.id, {
        date: a.weekStartDate,
        eventType: a.eventType,
        kind: a.partKey,
        title: a.partTitle ?? undefined,
      });
    }
    for (const d of duties) {
      perEntity.set(d.id, {
        date: d.weekStartDate,
        eventType: d.eventType,
        kind: d.dutyType,
        title: d.customLabel ?? undefined,
      });
    }
    for (const c of cleaning) {
      perEntity.set(c.id, { date: c.weekStartDate, kind: c.slotType });
    }
    for (const m of fieldService) {
      perEntity.set(m.id, {
        date: m.weekStartDate,
        title: m.address ?? undefined,
      });
    }

    for (const row of rows) {
      const ctx = perEntity.get(row.entityId);
      if (ctx) out.set(row.id, ctx);
    }
    return out;
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
