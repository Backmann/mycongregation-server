import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';

export type AuditAction = 'UPDATE' | 'CREATE' | 'DELETE';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorUserId: string;
  actorName: string | null;
  changedFields: string[];
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  createdAt: string;
}

@Injectable()
export class AuditLogService {
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
    actorUserId: string;
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
        actorUserId: opts.actorUserId,
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
    actorUserId: string;
    after: Record<string, any>;
  }): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        congregationId: opts.tenantId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: 'CREATE',
        actorUserId: opts.actorUserId,
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
    actorUserId: string;
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
        actorUserId: opts.actorUserId,
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
