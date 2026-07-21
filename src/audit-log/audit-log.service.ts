import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { requestContext } from '../common/request-context';

/**
 * Beyond the three that change data:
 *  VIEW     — someone looked at something looking is a privilege for (an S-21
 *             card). The app already treats seeing another person's data as a
 *             right that has to be granted; a granted right that leaves no
 *             trace cannot be answered for.
 *  DOWNLOAD — something left the server: a backup, an export.
 *  DENY     — an attempt the server refused. The past freezes and permissions
 *             bite, and until now every rejection vanished silently. A refused
 *             attempt to edit last week's meeting is precisely what a journal
 *             is consulted about.
 */
export type AuditAction =
  | 'UPDATE'
  | 'CREATE'
  | 'DELETE'
  | 'VIEW'
  | 'DOWNLOAD'
  | 'DENY';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  /** Null when the change was made by the system rather than a person. */
  actorUserId: string | null;
  actorName: string | null;
  changedFields: string[];
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  createdAt: string;
  subjectId?: string | null;
  /** True when the values were cleared at the subject's request. */
  redacted?: boolean;
}

@Injectable()
export class AuditLogService {
  /**
   * Who is acting. Callers that already hold the user may pass it; everyone
   * else gets it from the request context, which is the point of that context
   * — a service that changes assignments should not have to be handed a user
   * just so the journal can name one.
   */
  private actorOf(explicit?: string | null): {
    actorUserId: string | null;
    source: 'user' | 'system';
  } {
    const actorUserId = explicit ?? requestContext.get()?.userId ?? null;
    return { actorUserId, source: actorUserId ? 'user' : 'system' };
  }

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
  ) {}

  /**
   * Records an UPDATE diff. Only fields whose before/after values differ
   * are stored. If the resulting diff is empty (no fields changed) the
   * call is a no-op and no row is written.
   */
  async logUpdate<T extends Record<string, any>>(opts: {
    tenantId: string;
    entityType: string;
    entityId: string;
    actorUserId?: string | null;
    subjectId?: string | null;
    before: T;
    after: T;
    fields: (keyof T)[];
  }): Promise<void> {
    const changed: string[] = [];
    const beforeChanged: Record<string, any> = {};
    const afterChanged: Record<string, any> = {};
    for (const f of opts.fields) {
      const a = opts.before[f];
      const b = opts.after[f];
      if (a !== b) {
        const name = f as string;
        changed.push(name);
        beforeChanged[name] = a ?? null;
        afterChanged[name] = b ?? null;
      }
    }
    if (changed.length === 0) return;

    await this.auditRepo.save(
      this.auditRepo.create({
        congregationId: opts.tenantId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: 'UPDATE',
        ...this.actorOf(opts.actorUserId),
        subjectId: opts.subjectId ?? null,
        beforeJson: JSON.stringify(beforeChanged),
        afterJson: JSON.stringify(afterChanged),
        changedFields: changed,
      }),
    );
  }

  /**
   * Records a CREATE event. Used when a new entity is inserted by an admin
   * (e.g. user invitation) and there is no meaningful "before" state.
   *
   * The `after` snapshot is stored verbatim — callers are responsible for
   * omitting sensitive fields (e.g. passwordHash) from the payload.
   */
  async logCreate(opts: {
    tenantId: string;
    entityType: string;
    entityId: string;
    actorUserId?: string | null;
    subjectId?: string | null;
    after: Record<string, any>;
  }): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        congregationId: opts.tenantId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: 'CREATE',
        ...this.actorOf(opts.actorUserId),
        subjectId: opts.subjectId ?? null,
        beforeJson: null,
        afterJson: JSON.stringify(opts.after),
        changedFields: Object.keys(opts.after),
      }),
    );
  }

  /**
   * Records an UPDATE event WITHOUT auto-diffing. The caller provides
   * `changedFields`, `before` and `after` snapshots explicitly.
   *
   * Use this when sensitive values must be masked — e.g. an admin password
   * reset records `{ passwordHash: '<redacted>' }` on both sides because the
   * actual hash must never appear in the audit log. The auto-diffing
   * `logUpdate` would otherwise treat equal masked values as "unchanged"
   * and write nothing.
   */
  async logRawUpdate(opts: {
    tenantId: string;
    entityType: string;
    entityId: string;
    actorUserId?: string | null;
    subjectId?: string | null;
    changedFields: string[];
    before: Record<string, any>;
    after: Record<string, any>;
  }): Promise<void> {
    if (opts.changedFields.length === 0) return;

    await this.auditRepo.save(
      this.auditRepo.create({
        congregationId: opts.tenantId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: 'UPDATE',
        ...this.actorOf(opts.actorUserId),
        subjectId: opts.subjectId ?? null,
        beforeJson: JSON.stringify(opts.before),
        afterJson: JSON.stringify(opts.after),
        changedFields: opts.changedFields,
      }),
    );
  }

  /**
   * Returns audit log entries for a single entity (newest first), with
   * actor display names enriched from the Publisher table (best-effort:
   * `actorName` is null if the actor has no Publisher record).
   */
  async findForEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditLogEntry[]> {
    const rows = await this.auditRepo.find({
      where: { congregationId: tenantId, entityType, entityId },
      order: { createdAt: 'DESC' },
    });
    if (rows.length === 0) return [];

    const actorIds = Array.from(new Set(rows.map((r) => r.actorUserId)));
    const publishers = actorIds.length
      ? await this.publishersRepo.find({
          where: { congregationId: tenantId, userId: In(actorIds) },
        })
      : [];
    const pubByUserId = new Map(publishers.map((p) => [p.userId, p]));

    return rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      actorUserId: r.actorUserId,
      actorName: pubByUserId.get(r.actorUserId)?.displayName ?? null,
      changedFields: r.changedFields ?? [],
      before: r.beforeJson ? JSON.parse(r.beforeJson) : null,
      after: r.afterJson ? JSON.parse(r.afterJson) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Records that something HAPPENED, with no before/after to speak of: a card
   * was viewed, a backup downloaded, an attempt refused, a bulk import run.
   *
   * `detail` is for the few facts that make the line readable later — which
   * year of the S-21, how many weeks an import covered, which rule refused
   * the attempt. It is not a place for the data itself.
   */
  async logEvent(opts: {
    tenantId: string;
    entityType: string;
    entityId: string;
    action: Exclude<AuditAction, 'UPDATE' | 'CREATE'>;
    actorUserId?: string | null;
    subjectId?: string | null;
    detail?: Record<string, any>;
  }): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        congregationId: opts.tenantId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: opts.action,
        ...this.actorOf(opts.actorUserId),
        subjectId: opts.subjectId ?? null,
        beforeJson: null,
        afterJson: opts.detail ? JSON.stringify(opts.detail) : null,
        changedFields: [],
      }),
    );
  }

  /**
   * Records WHICH fields changed and nothing more — no old value, no new one.
   *
   * For personal contact details this is the whole of what a journal needs:
   * "the phone number was changed, by this person, on this date" answers every
   * question a dispute raises. Keeping the numbers themselves would quietly
   * turn the journal into a second, permanent copy of everyone's contact
   * history — the most sensitive table in the database, and one that outlives
   * the card it mirrors.
   */
  async logFieldsChanged(opts: {
    tenantId: string;
    entityType: string;
    entityId: string;
    actorUserId?: string | null;
    subjectId?: string | null;
    fields: string[];
  }): Promise<void> {
    if (opts.fields.length === 0) return;
    await this.auditRepo.save(
      this.auditRepo.create({
        congregationId: opts.tenantId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: 'UPDATE',
        ...this.actorOf(opts.actorUserId),
        subjectId: opts.subjectId ?? null,
        beforeJson: null,
        afterJson: null,
        changedFields: opts.fields,
      }),
    );
  }

  /**
   * Empties the values of every entry concerning a person, keeping the entries
   * themselves. Called when someone exercises their right to erasure.
   *
   * Rows are kept deliberately. "Who changed the schedule last March" is the
   * congregation's own record, and one member's erasure request must not be
   * able to remove the trace of what somebody else did. What goes is only what
   * belonged to the person asking: the values, and the field names, which for
   * contact details are themselves telling.
   *
   * Returns how many entries were emptied.
   */
  async redactForPerson(
    tenantId: string,
    personIds: string[],
  ): Promise<number> {
    const ids = personIds.filter(Boolean);
    if (ids.length === 0) return 0;

    const rows = await this.auditRepo.find({
      where: [
        { congregationId: tenantId, actorUserId: In(ids) },
        { congregationId: tenantId, subjectId: In(ids) },
        { congregationId: tenantId, entityId: In(ids) },
      ],
    });
    const pending = rows.filter((r) => r.redactedAt === null);
    if (pending.length === 0) return 0;

    for (const row of pending) {
      row.beforeJson = null;
      row.afterJson = null;
      row.changedFields = [];
      row.redactedAt = new Date();
    }
    await this.auditRepo.save(pending);
    return pending.length;
  }

  /**
   * Delete audit-log entries older than the retention window (default 12
   * months ≈ 365 days). Enforces the storage-limitation period stated in the
   * privacy policy (GDPR Art. 5(1)(e)). Returns the number of rows removed.
   */
  async cleanupOldAuditLogs(retentionDays = 365): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.auditRepo.delete({ createdAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}
