import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { refusal } from '../common/errors/refusal';
import type { TerritoryGeometry } from '../entities/territory.entity';
import { boxOf, pointInside } from './geometry';
import { addressNumber, streetKey } from './split';

/**
 * Applying a decided proposal of the re-cutting draft (16 November 2026,
 * step 5): the parts that are pure decisions, kept apart so they can be
 * checked without a database.
 */

/** An official address: its street, number and point (`map_addresses`). */
export interface OfficialAddress {
  at: [number, number];
  street: string;
  number: string;
}

/**
 * The part each «не посещать» address lies in, by the official address of
 * the same street and number: null when no official address matches, or
 * when matches lie in different parts (the same street name in two
 * villages) — the keeper then chooses.
 */
export function placeNoCalls(
  calls: { id: string; address: string }[],
  parts: TerritoryGeometry[],
  addresses: OfficialAddress[],
): { id: string; part: number | null }[] {
  const boxes = parts.map((g) => boxOf(g));
  const partOfPoint = (p: [number, number]): number => {
    for (let i = 0; i < parts.length; i++) {
      const [x0, y0, x1, y1] = boxes[i];
      if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
      if (pointInside(p, parts[i])) return i;
    }
    return -1;
  };
  const byKey = new Map<string, OfficialAddress[]>();
  for (const a of addresses) {
    const key = `${streetKey(a.street)}|${a.number.replace(/\s+/g, '').toLowerCase()}`;
    const list = byKey.get(key);
    if (list) list.push(a);
    else byKey.set(key, [a]);
  }
  return calls.map((c) => {
    const street = streetKey(c.address.split(',')[0]);
    const no = addressNumber(c.address);
    if (!street || !no) return { id: c.id, part: null };
    const found = (byKey.get(`${street}|${no}`) ?? [])
      .map((a) => partOfPoint(a.at))
      .filter((i) => i >= 0);
    const distinct = [...new Set(found)];
    return { id: c.id, part: distinct.length === 1 ? distinct[0] : null };
  });
}

/**
 * The day a join counts as last worked: the oldest of its territories';
 * one never worked makes it never worked.
 */
export function oldestWorked(days: (string | null)[]): string | null {
  if (days.length === 0 || days.some((d) => !d)) return null;
  return [...(days as string[])].sort()[0];
}

/** A decided join: how many of its territories are free, and which wait. */
export function joinStanding(
  ts: { id: string; number: string; heldSince: string | null }[],
): {
  free: number;
  total: number;
  waiting: { number: string; since: string }[];
} {
  const waiting = ts
    .filter((t) => t.heldSince)
    .map((t) => ({ number: t.number, since: t.heldSince as string }));
  return { free: ts.length - waiting.length, total: ts.length, waiting };
}

/**
 * Refuses giving out a territory held back for a decided join, unless the
 * keeper gives it out anyway — then the hold is let go
 * (territory-assignments.service assign).
 */
/**
 * Territories a decided re-cutting waits for (17 November 2026): in an open
 * proposal the service committee approved. Kept «for working again», one of
 * these would put the decision off by another four months unseen.
 */
export async function awaitingRecut(
  m: EntityManager,
  tenantId: string,
  territoryIds: string[],
): Promise<Set<string>> {
  if (territoryIds.length === 0) return new Set();
  const rows = await m.query<{ id: string }[]>(
    `SELECT DISTINCT unnest(territory_ids)::text AS id
       FROM territory_recut_proposals
      WHERE congregation_id = $1 AND state = 'open'
        AND approved_at IS NOT NULL AND territory_ids && $2::uuid[]`,
    [tenantId, territoryIds],
  );
  const wanted = new Set(territoryIds);
  return new Set(rows.map((r) => r.id).filter((id) => wanted.has(id)));
}

export async function mustNotBeHeldBack(
  m: EntityManager,
  tenantId: string,
  territoryId: string,
  number: string,
  release: boolean,
): Promise<void> {
  const rows = await m.query<{ id: string }[]>(
    `SELECT id FROM territory_recut_proposals
      WHERE congregation_id = $1 AND state = 'open'
        AND approved_at IS NOT NULL AND $2 = ANY(hold_ids)`,
    [tenantId, territoryId],
  );
  if (rows.length === 0) return;
  if (!release) {
    throw new ConflictException(
      refusal('TERRITORY_HELD_FOR_RECUT', `${number} is held for a join.`, {
        number,
      }),
    );
  }
  await m.query(
    `UPDATE territory_recut_proposals SET hold_ids = array_remove(hold_ids, $2)
      WHERE congregation_id = $1 AND $2 = ANY(hold_ids)`,
    [tenantId, territoryId],
  );
}
