import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { Territory } from '../entities/territory.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TerritoryAccessService } from './territory-access.service';
import {
  HistoryKind,
  TERRITORY_ENTITY_TYPES,
  historyKind,
  kindsOf,
} from './territory-history';
import { holderNameOf } from './territory-assignments.service';

export interface HistoryItem {
  id: string;
  at: string;
  kind: HistoryKind;
  entityType: string;
  territoryId: string | null;
  number: string | null;
  /** The holder of the line as the S-13 writes it. */
  holder: string | null;
  /** Handed on: who held it before. */
  fromHolder: string | null;
  forGroup: string | null;
  /** Who did it — the name on his card; null: the system or nobody known. */
  actor: string | null;
  /** The facts as the step wrote them; the app makes the sentence. */
  detail: Record<string, unknown> | null;
}

/** Rows read per round, and the most one answer may read. */
const ROUND = 400;
const MAX_READ = 6000;

/**
 * The journal of a territory and «Что происходит» (17 November 2026) for
 * those who see the whole section: the keepers and the service committee.
 * Read-only, like the journal itself; it goes back as far as the journal
 * keeps (a year).
 *
 * The journal's values are encrypted at rest, so the territory is found
 * after reading, not in SQL: rows are read newest first in rounds until a
 * page is full.
 */
@Injectable()
export class TerritoryHistoryService {
  constructor(
    private readonly access: TerritoryAccessService,
    @InjectRepository(AuditLog)
    private readonly audit: Repository<AuditLog>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
  ) {}

  async history(
    user: AuthenticatedUser,
    q: {
      territoryId?: string;
      filter?: string;
      before?: string;
      limit?: number;
    },
  ): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    await this.access.mustSeeAll(user);
    const tenantId = user.congregationId;
    const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
    const wanted = kindsOf(q.filter);
    const number = q.territoryId
      ? ((
          await this.territories.findOne({
            where: { id: q.territoryId, congregationId: tenantId },
            select: { id: true, number: true },
          })
        )?.number ?? null)
      : null;

    const picked: { row: AuditLog; kind: HistoryKind; d: Detail | null }[] = [];
    let cursor = q.before ? new Date(q.before) : null;
    let read = 0;
    let more = true;
    while (picked.length <= limit && more && read < MAX_READ) {
      const rows = await this.audit.find({
        where: {
          congregationId: tenantId,
          entityType: In(TERRITORY_ENTITY_TYPES),
          ...(cursor ? { createdAt: LessThan(cursor) } : {}),
        },
        order: { createdAt: 'DESC' },
        take: ROUND,
      });
      read += rows.length;
      more = rows.length === ROUND;
      for (const row of rows) {
        const d = parse(row.afterJson);
        const kind = historyKind(row.entityType, row.action, d);
        if (kind === 'quiet') continue;
        if (wanted && !wanted.includes(kind)) continue;
        if (q.territoryId && !concerns(row, d, q.territoryId, number)) {
          continue;
        }
        picked.push({ row, kind, d });
        if (picked.length > limit) break;
      }
      if (rows.length) cursor = rows[rows.length - 1].createdAt;
    }
    const page = picked.slice(0, limit);
    // A next page exists if this one overflowed, or the reading stopped at
    // its ceiling with more rows behind it.
    const nextCursor =
      picked.length > limit || (more && read >= MAX_READ)
        ? (page[page.length - 1]?.row.createdAt.toISOString() ??
          cursor?.toISOString() ??
          null)
        : null;

    // Older entries carry less: the holder and the number come from the
    // line and the territory while they exist.
    const lineIds = page
      .filter((p) => p.row.entityType === 'territory_assignment')
      .flatMap((p) => [
        p.row.entityId,
        ...(typeof p.d?.transferredFrom === 'string'
          ? [p.d.transferredFrom]
          : []),
      ]);
    const lines = new Map(
      (lineIds.length
        ? await this.assignments.find({
            where: { congregationId: tenantId, id: In([...new Set(lineIds)]) },
            select: {
              id: true,
              territoryId: true,
              holderName: true,
              forGroupName: true,
            },
          })
        : []
      ).map((a) => [a.id, a]),
    );
    const territoryIds = new Set<string>();
    for (const p of page) {
      const tid = territoryOf(p.row, p.d, lines);
      if (tid) territoryIds.add(tid);
    }
    const numbers = new Map(
      (territoryIds.size
        ? await this.territories.find({
            where: { congregationId: tenantId, id: In([...territoryIds]) },
            select: { id: true, number: true },
            withDeleted: true,
          })
        : []
      ).map((t) => [t.id, t.number]),
    );
    const actorIds = [
      ...new Set(page.map((p) => p.row.actorUserId).filter(isString)),
    ];
    const actors = new Map(
      (actorIds.length
        ? await this.publishers.find({
            where: { congregationId: tenantId, userId: In(actorIds) },
            select: { id: true, userId: true, firstName: true, lastName: true },
          })
        : []
      ).map((p) => [p.userId as string, holderNameOf(p)]),
    );

    return {
      items: page.map(({ row, kind, d }) => {
        const line = lines.get(row.entityId);
        const tid = territoryOf(row, d, lines);
        const from =
          typeof d?.transferredFrom === 'string'
            ? lines.get(d.transferredFrom)
            : undefined;
        return {
          id: row.id,
          at: row.createdAt.toISOString(),
          kind,
          entityType: row.entityType,
          territoryId: tid,
          number:
            str(d?.number) ??
            str(d?.kept) ??
            (tid ? (numbers.get(tid) ?? null) : null),
          holder:
            row.entityType === 'territory_assignment'
              ? (str(d?.holder) ?? line?.holderName ?? null)
              : null,
          fromHolder: str(d?.fromHolder) ?? from?.holderName ?? null,
          forGroup:
            str(d?.forGroup) ??
            (row.entityType === 'territory_assignment'
              ? (line?.forGroupName ?? null)
              : null),
          actor: row.actorUserId ? (actors.get(row.actorUserId) ?? null) : null,
          detail: d,
        };
      }),
      nextCursor,
    };
  }
}

type Detail = Record<string, unknown>;

function parse(json: string | null): Detail | null {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Detail)
      : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function territoryOf(
  row: AuditLog,
  d: Detail | null,
  lines: Map<string, { territoryId: string }>,
): string | null {
  // The congregation's own boundary is no territory's.
  if (row.entityType === 'territory_boundary') return null;
  if (row.entityType === 'territory') {
    // A re-cutting applied names its territories by number, under the
    // congregation's id.
    if (row.entityId === row.congregationId) return null;
    return str(d?.territoryId) ?? row.entityId;
  }
  return str(d?.territoryId) ?? lines.get(row.entityId)?.territoryId ?? null;
}

/** Whether a journal row is about this territory. */
function concerns(
  row: AuditLog,
  d: Detail | null,
  territoryId: string,
  number: string | null,
): boolean {
  if (row.entityId === territoryId) return true;
  if (d?.territoryId === territoryId) return true;
  // A campaign and a re-cutting applied name their territories by number.
  if (number && d) {
    for (const key of ['campaign', 'made', 'archived']) {
      const list = d[key];
      if (Array.isArray(list) && list.includes(number)) return true;
    }
    if (d.recut && (d.kept === number || d.number === number)) return true;
  }
  return false;
}
