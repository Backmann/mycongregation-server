/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
//
// TODO P1 #17 Etap 3: properly type audit log JSON column access.
// This service reads beforeJson/afterJson columns from AuditLog, which
// store polymorphic snapshots whose shape depends on entityType
// ('publisher' vs 'service_report' vs others). Proper fix requires:
//   (1) typing parseJson<T>() with a generic
//   (2) defining per-entity snapshot interfaces (PublisherSnapshot,
//       ServiceReportSnapshot, etc.)
//   (3) discriminated-union access based on row.entityType
// Until then, suppressing the 48 unsafe-* errors here so the rest of
// the baseline can land in CI.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { User } from '../entities/user.entity';

export type ActivityFeedEntryType =
  | 'status_change'
  | 'report_submitted'
  | 'report_updated'
  | 'override_applied'
  | 'override_cleared'
  | 'other';

export interface ActivityFeedEntry {
  id: string;
  type: ActivityFeedEntryType;
  occurredAt: string;
  actorName: string | null;
  targetType: 'publisher' | 'service_report' | 'other';
  targetId: string;
  summary: string;
  publisherName?: string;
  reportMonth?: string;
  oldStatus?: string;
  newStatus?: string;
}

export interface ActivityFeedResponse {
  items: ActivityFeedEntry[];
  nextCursor: string | null;
}

const MONITORED_ENTITY_TYPES = ['publisher', 'service_report'];

@Injectable()
export class ActivityFeedService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publisherRepo: Repository<Publisher>,
    @InjectRepository(ServiceReport)
    private readonly reportRepo: Repository<ServiceReport>,
  ) {}

  async findFeed(
    congregationId: string,
    opts: { limit?: number; before?: string },
  ): Promise<ActivityFeedResponse> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const where: any = {
      congregationId,
      entityType: In(MONITORED_ENTITY_TYPES),
    };
    if (opts.before) {
      where.createdAt = LessThan(new Date(opts.before));
    }

    const rows = await this.auditRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // Batch enrich actors
    const userIds = uniq(pageRows.map((r) => r.actorUserId));
    const users = userIds.length
      ? await this.userRepo.findBy({ id: In(userIds) })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Batch enrich publisher & report targets
    const directPubIds = pageRows
      .filter((r) => r.entityType === 'publisher')
      .map((r) => r.entityId);
    const reportIds = pageRows
      .filter((r) => r.entityType === 'service_report')
      .map((r) => r.entityId);

    const reports = reportIds.length
      ? await this.reportRepo.findBy({ id: In(reportIds) })
      : [];
    const reportMap = new Map(reports.map((r) => [r.id, r]));

    const reportPubIds = reports.map((r) => r.publisherId);
    const allPubIds = uniq([...directPubIds, ...reportPubIds]);
    const publishers = allPubIds.length
      ? await this.publisherRepo.findBy({ id: In(allPubIds) })
      : [];
    const pubMap = new Map(publishers.map((p) => [p.id, p]));

    const items = pageRows.map((row) =>
      this.buildEntry(row, userMap, pubMap, reportMap),
    );
    const nextCursor = hasMore
      ? pageRows[pageRows.length - 1].createdAt.toISOString()
      : null;

    return { items, nextCursor };
  }

  private buildEntry(
    row: AuditLog,
    userMap: Map<string, User>,
    pubMap: Map<string, Publisher>,
    reportMap: Map<string, ServiceReport>,
  ): ActivityFeedEntry {
    // A system change has no actor by design — say so rather than showing it
    // as an unknown person, which reads like a fault.
    const actor = row.actorUserId ? userMap.get(row.actorUserId) : undefined;
    const actorName = formatUserName(actor);
    const actorLabel =
      actorName ?? (row.source === 'system' ? '(system)' : '(unknown actor)');
    const before = parseJson(row.beforeJson);
    const after = parseJson(row.afterJson);
    const occurredAt = row.createdAt.toISOString();

    if (row.entityType === 'publisher') {
      const publisher = pubMap.get(row.entityId) as any;
      const publisherName = publisher?.displayName ?? '(deleted publisher)';

      const beforeOverride = before?.statusManuallyOverridden === true;
      const afterOverride = after?.statusManuallyOverridden === true;
      const beforeStatus = before?.status;
      const afterStatus = after?.status;

      if (afterOverride && !beforeOverride) {
        return {
          id: row.id,
          type: 'override_applied',
          occurredAt,
          actorName,
          targetType: 'publisher',
          targetId: row.entityId,
          summary: `${actorLabel} manually set ${publisherName}'s status to ${afterStatus ?? 'unknown'}`,
          publisherName,
          oldStatus: beforeStatus,
          newStatus: afterStatus,
        };
      }

      if (beforeOverride && !afterOverride) {
        return {
          id: row.id,
          type: 'override_cleared',
          occurredAt,
          actorName,
          targetType: 'publisher',
          targetId: row.entityId,
          summary: `${actorLabel} cleared status override for ${publisherName}`,
          publisherName,
        };
      }

      if (
        beforeStatus !== undefined &&
        afterStatus !== undefined &&
        beforeStatus !== afterStatus
      ) {
        return {
          id: row.id,
          type: 'status_change',
          occurredAt,
          actorName,
          targetType: 'publisher',
          targetId: row.entityId,
          summary: `${publisherName}'s status changed from ${beforeStatus} to ${afterStatus}`,
          publisherName,
          oldStatus: beforeStatus,
          newStatus: afterStatus,
        };
      }

      return {
        id: row.id,
        type: 'other',
        occurredAt,
        actorName,
        targetType: 'publisher',
        targetId: row.entityId,
        summary: `${actorLabel} updated ${publisherName}`,
        publisherName,
      };
    }

    if (row.entityType === 'service_report') {
      const report = reportMap.get(row.entityId);
      const publisher = report ? (pubMap.get(report.publisherId) as any) : null;
      const publisherName = publisher?.displayName ?? '(unknown publisher)';
      const reportMonth =
        report?.reportMonth ??
        after?.reportMonth ??
        before?.reportMonth ??
        null;
      const monthLabel = reportMonth
        ? formatMonth(reportMonth)
        : '(unknown month)';

      if (row.action === 'create') {
        return {
          id: row.id,
          type: 'report_submitted',
          occurredAt,
          actorName,
          targetType: 'service_report',
          targetId: row.entityId,
          summary: `${publisherName} submitted ${monthLabel} report`,
          publisherName,
          reportMonth: reportMonth ?? undefined,
        };
      }

      return {
        id: row.id,
        type: 'report_updated',
        occurredAt,
        actorName,
        targetType: 'service_report',
        targetId: row.entityId,
        summary: `${actorLabel} updated ${publisherName}'s ${monthLabel} report`,
        publisherName,
        reportMonth: reportMonth ?? undefined,
      };
    }

    return {
      id: row.id,
      type: 'other',
      occurredAt,
      actorName,
      targetType: 'other',
      targetId: row.entityId,
      summary: `${actorLabel} ${row.action}d ${row.entityType}`,
    };
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function parseJson(raw: string | null): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatUserName(u: any): string | null {
  if (!u) return null;
  if (u.fullName) return u.fullName;
  if (u.displayName) return u.displayName;
  if (u.firstName || u.lastName) {
    const combined = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return combined || null;
  }
  if (u.name) return u.name;
  if (u.email) return u.email;
  return null;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatMonth(reportMonth: string): string {
  // reportMonth is YYYY-MM-DD (always first of month)
  const d = new Date(reportMonth + 'T00:00:00Z');
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
