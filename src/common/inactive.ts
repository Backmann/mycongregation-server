import { BadRequestException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { PublisherStatus } from './enums/publisher-status.enum';
import { refusal } from './errors/refusal';

/**
 * An inactive publisher is given no task (Lionel, 31 October 2026:
 * «неактивные не могут быть задействованы в обязанностях или в программе»).
 * The ONE test every candidate list on the server asks. When a report comes
 * in, the status is recomputed at once and he is a candidate again.
 *
 * Whoever is told «not offered» is never told why: only elders may know who
 * is inactive, so a refusal or a reason code built on this stays neutral.
 */
export function isInactive(p: { status?: PublisherStatus | null }): boolean {
  return p.status === PublisherStatus.INACTIVE;
}

/**
 * Refuse to put an inactive publisher on anything (1 November 2026).
 *
 * `next` are the people the save would leave on the record, `prev` those it
 * already held: only someone NEW is checked, so an elder may still change the
 * time or the note of a part an inactive brother holds since before he
 * lapsed (that brother is the elders' reminder to settle, not a lock).
 *
 * The refusal names nobody's standing — whoever is told it may not know
 * who is inactive.
 */
export async function assertAssignable(
  manager: EntityManager | undefined,
  congregationId: string,
  next: ReadonlyArray<string | null | undefined>,
  prev: ReadonlyArray<string | null | undefined> = [],
): Promise<void> {
  const held = new Set(prev.filter((x): x is string => !!x));
  const fresh = [
    ...new Set(next.filter((x): x is string => !!x && !held.has(x))),
  ];
  if (fresh.length === 0) return;
  // Specs that build a service by hand give it a repository without a
  // manager; a real one always has it.
  if (typeof manager?.getRepository !== 'function') return;
  const blocked = await manager.getRepository(Publisher).count({
    where: {
      congregationId,
      id: In(fresh),
      status: PublisherStatus.INACTIVE,
    },
  });
  if (blocked > 0) {
    throw new BadRequestException(
      refusal(
        'PERSON_NOT_ASSIGNABLE',
        'This person cannot be given a task at the moment.',
      ),
    );
  }
  // A screen opened before two cards were merged still offers the card that
  // is gone (1 November 2026): say so, rather than a bare «not found» or a
  // broken link.
  if (typeof manager.query !== 'function') return;
  const found = await manager.getRepository(Publisher).count({
    where: { congregationId, id: In(fresh) },
    withDeleted: true,
  });
  if (found < fresh.length) {
    const merged: unknown[] = await manager.query(
      `SELECT 1 FROM publisher_merges
        WHERE congregation_id = $1 AND merged_id = ANY($2::uuid[]) AND undone_at IS NULL
        LIMIT 1`,
      [congregationId, fresh],
    );
    if (merged.length > 0) {
      throw new BadRequestException(
        refusal(
          'CARD_MERGED',
          'This card was merged into another; reload and choose again.',
        ),
      );
    }
  }
}
