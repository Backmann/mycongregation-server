import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { EntityManager, In, IsNull, LessThan, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { PublisherMerge } from '../entities/publisher-merge.entity';
import { User } from '../entities/user.entity';
import { RefreshSession } from '../entities/refresh-session.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { refusal } from '../common/errors/refusal';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UsersService } from '../users/users.service';
import { PublishersService } from './publishers.service';
import { deriveRoleFromAppointment } from './derive-role';
import { alike, emailKey, nameKey, phoneKey } from './duplicate-keys';
import { pairPeriod } from '../tasks/possible-duplicate.service';

/** How long «Разъединить» stays possible, and the record with it. */
export const MERGE_UNDO_DAYS = 30;

/** Tables whose rows never move: they are marks, not history. */
const DROP_TABLES = new Set(['publisher_distinct_pairs']);

/** Tables whose rows carry the merged card's id on purpose. */
const SCAN_EXCLUDED = new Set([
  'audit_logs',
  'publisher_merges',
  'migrations',
  'typeorm_metadata',
]);

/**
 * The card's own fields a merge brings together. Where the kept card is
 * empty the merged card's value is taken without asking; where both are
 * filled and differ, the person merging chooses (the kept card's by default).
 */
const FIELDS = [
  'firstName',
  'middleName',
  'lastName',
  'gender',
  'birthDate',
  'mobilePhone',
  'email',
  'address',
  'appointment',
  'baptismDate',
  'ministryStartDate',
  'pioneerType',
  'pioneerSince',
  'pioneerMonthGoal',
  'spiritualStatus',
  'notes',
  'isDeaf',
  'isBlind',
  'isImprisoned',
  'serviceGroupId',
] as const;
type Field = (typeof FIELDS)[number];
const CONTACT_FIELDS: Field[] = ['mobilePhone', 'email', 'address'];
/**
 * Everything of the kept card a merge may write, by its decrypted value —
 * compared that way on undo, because an encrypted column is written anew
 * (another ciphertext for the same words) every time the card is saved.
 */
const KEPT_PROPS = [
  ...FIELDS,
  'memberSince',
  'capabilities',
  'publicTalkNumbers',
  'displayName',
  'contactsConfirmedAt',
  'contactsConfirmedByUserId',
] as const;
const DATE_PROPS = new Set<string>(['contactsConfirmedAt']);

/** Column name for a field (the database is snake_case). */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

interface Link {
  table: string;
  column: string;
  pk: string[];
}
type Pk = Record<string, unknown>;

export interface MergeCardFacts {
  id: string;
  displayName: string;
  group: string | null;
  appointment: string;
  gender: string;
  birthDate: string | null;
  baptismDate: string | null;
  memberSince: string | null;
  createdAt: string;
  departed: boolean;
  reports: number;
  account: {
    userId: string;
    login: string | null;
    lastSeenAt: string | null;
  } | null;
}

export interface MergeConflictOption {
  /** A row id, or 'kept' / 'merged' for a choice of side. */
  id: string;
  side: 'kept' | 'merged';
  /** Words for people: a report's figures, a spell's months. */
  facts: Record<string, string | number | boolean | null>;
}
export interface MergeConflict {
  key: string;
  kind: 'report' | 'pioneer_spells' | 'auxiliary_pioneers';
  /** The month, for a report. */
  month: string | null;
  options: MergeConflictOption[];
}
export interface MergeFieldDiff {
  field: Field;
  kept: unknown;
  merged: unknown;
  /** 'take': the kept card is empty, the merged value comes over. */
  rule: 'take' | 'choose';
}
export interface MergePlanView {
  kept: MergeCardFacts;
  merged: MergeCardFacts;
  moves: Record<string, number>;
  joined: Record<string, number>;
  conflicts: MergeConflict[];
  fields: MergeFieldDiff[];
  accounts: 'none' | 'move' | 'choose';
  needsAdmin: boolean;
  /** Months a sent report counted both cards — said, not corrected. */
  countedTwice: string[];
  /** Somebody said these are two people — or undid their merge. */
  markedDistinct: boolean;
  blockers: string[];
  fingerprint: string;
}

export interface MergeDecisions {
  fingerprint: string;
  /** conflict key → option id */
  choices?: Record<string, string>;
  /** field → which card's value stays (only for rule 'choose') */
  fields?: Record<string, 'kept' | 'merged'>;
  /** Both cards have a sign-in: the one that stays. */
  keepUserId?: string;
}

/** What «Разъединить» needs. Encrypted at rest, gone after thirty days. */
interface MergePayload {
  v: 1;
  mergedRow: Record<string, unknown>;
  keptBefore: Record<string, unknown>;
  keptAfter: Record<string, unknown>;
  moved: { table: string; column: string; pks: Pk[] }[];
  dropped: { table: string; row: Record<string, unknown> }[];
  json: {
    table: string;
    column: string;
    pk: Pk;
    before: string;
    after: string;
  }[];
  accounts: {
    keptUserBefore: string | null;
    mergedUserBefore: string | null;
    closedUserId: string | null;
    closedWasActive: boolean;
    movedResponsibilities: string[];
    droppedResponsibilities: Record<string, unknown>[];
  };
}

interface Plan {
  view: MergePlanView;
  links: Link[];
  movePks: { link: Link; pks: Pk[] }[];
  /** Rows dropped whatever is chosen: duplicates, deleted rows, marks. */
  autoDrop: { table: string; pk: Pk }[];
  /** conflict key → option id → rows that go if that option is NOT chosen */
  conflictRows: Map<string, Map<string, { table: string; pk: Pk }[]>>;
  keptCard: Publisher;
  mergedCard: Publisher;
}

class Rollback extends Error {}

/**
 * «Объединить карточки» (1 November 2026).
 *
 * One person entered twice: every row that names the second card comes over
 * to the first, in ONE transaction, and the second card is deleted. Nothing
 * is lost: what could not come over (the report of a month both cards had,
 * the side not chosen) is kept in the merge's record for thirty days, and
 * «Разъединить» puts every row back where it was.
 *
 * Three things make it safe rather than merely careful:
 *  - The links are read from the database, not listed by hand: a table
 *    added next year is moved without anyone remembering it here.
 *  - The preview IS the merge, done and rolled back. What the window shows
 *    is what pressing the button does; the button sends the preview's
 *    fingerprint, and if anything changed in between, nothing is done.
 *  - Before the card is deleted, the whole database is searched for its id.
 *    One row still naming it and everything is rolled back.
 */
@Injectable()
export class CardMergeService {
  private readonly logger = new Logger(CardMergeService.name);

  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(PublisherMerge)
    private readonly merges: Repository<PublisherMerge>,
    private readonly publishersService: PublishersService,
    private readonly usersService: UsersService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------- preview

  async preview(
    tenantId: string,
    keptId: string,
    mergedId: string,
    actor: { id?: string; role?: UserRole },
    keepUserId?: string,
  ): Promise<MergePlanView> {
    let view: MergePlanView | null = null;
    try {
      await this.publishers.manager.transaction(async (m) => {
        const plan = await this.plan(m, tenantId, keptId, mergedId, actor);
        view = plan.view;
        if (plan.view.blockers.length > 0) throw new Rollback();
        // The merge itself, with the defaults, so that whatever would fail
        // fails here, in the window, and not on the button.
        try {
          const d = this.defaults(plan);
          if (keepUserId) d.keepUserId = keepUserId;
          await this.execute(m, tenantId, plan, d, actor);
        } catch (e) {
          if (e instanceof Rollback) throw e;
          const code = this.codeOf(e);
          view = { ...plan.view, blockers: [code] };
          this.logger.warn(
            `merge preview ${keptId}<-${mergedId}: ${String(e)}`,
          );
        }
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return view!;
  }

  // ------------------------------------------------------------------ merge

  async merge(
    tenantId: string,
    keptId: string,
    mergedId: string,
    decisions: MergeDecisions,
    actor: { id?: string; role?: UserRole },
  ): Promise<{ mergeId: string }> {
    const done = await this.publishers.manager.transaction(async (m) => {
      const plan = await this.plan(m, tenantId, keptId, mergedId, actor);
      if (plan.view.blockers.length > 0) {
        throw new BadRequestException(
          refusal(
            'MERGE_BLOCKED',
            `Merge blocked: ${plan.view.blockers.join(', ')}`,
          ),
        );
      }
      if (plan.view.fingerprint !== decisions.fingerprint) {
        throw new ConflictException(
          refusal(
            'MERGE_PLAN_CHANGED',
            'Something changed on these cards since the preview; look again.',
          ),
        );
      }
      if (plan.view.needsAdmin && actor.role !== UserRole.ADMIN) {
        throw new ForbiddenException(
          refusal(
            'MERGE_ACCOUNT_ADMIN_ONLY',
            'A merge that moves or closes a sign-in is for an administrator.',
          ),
        );
      }
      return this.execute(m, tenantId, plan, decisions, actor);
    });

    await this.after(tenantId, keptId, actor.id ?? null);
    // The elders' «possibly the same card» task about this pair is answered.
    await this.publishers.manager.query(
      `UPDATE elder_tasks SET status = 'done', done_at = now(), done_by_id = $3
        WHERE congregation_id = $1 AND kind = 'possible_duplicate'
          AND kind_period = $2 AND status = 'open'`,
      [tenantId, pairPeriod(keptId, mergedId), actor.id ?? null],
    );
    for (const uid of [done.payload.accounts.closedUserId].filter(Boolean)) {
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'user',
        entityId: uid as string,
        actorUserId: actor.id ?? null,
        subjectId: uid as string,
        before: { isActive: true },
        after: { isActive: false },
        fields: ['isActive'],
      });
    }
    await this.auditLog.logRawUpdate({
      tenantId,
      entityType: 'publisher',
      entityId: keptId,
      actorUserId: actor.id ?? null,
      subjectId: null,
      changedFields: ['mergedWith'],
      before: { mergedWith: null },
      after: {
        mergedWith: String(done.payload.mergedRow['display_name'] ?? ''),
        moved: done.summary,
      },
    });
    return { mergeId: done.mergeId };
  }

  // ------------------------------------------------------------------- undo

  async listFor(
    tenantId: string,
    keptId: string,
  ): Promise<
    {
      id: string;
      createdAt: Date;
      expiresAt: Date;
      undoneAt: Date | null;
      summary: Record<string, number>;
      mergedName: string | null;
      canUndo: boolean;
    }[]
  > {
    const rows = await this.merges.find({
      where: { congregationId: tenantId, keptId },
      order: { createdAt: 'DESC' },
    });
    const latestOpen = rows.find((r) => !r.undoneAt);
    return rows.map((r) => {
      const p = this.readPayload(r);
      return {
        id: r.id,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        undoneAt: r.undoneAt,
        summary: r.summary,
        mergedName: p ? String(p.mergedRow['display_name'] ?? '') : null,
        canUndo:
          !r.undoneAt && r.id === latestOpen?.id && r.expiresAt > new Date(),
      };
    });
  }

  async undo(
    tenantId: string,
    mergeId: string,
    actor: { id?: string; role?: UserRole },
  ): Promise<{ restoredId: string; notReturned: Record<string, number> }> {
    const notReturned: Record<string, number> = {};
    const miss = (k: string, n = 1) => {
      notReturned[k] = (notReturned[k] ?? 0) + n;
    };
    const rec = await this.publishers.manager.transaction(async (m) => {
      const repo = m.getRepository(PublisherMerge);
      const rec = await repo.findOne({
        where: { id: mergeId, congregationId: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!rec) throw new NotFoundException('Merge not found');
      const payload = this.readPayload(rec);
      if (rec.undoneAt || !payload || rec.expiresAt <= new Date()) {
        throw new BadRequestException(
          refusal('MERGE_NOT_UNDOABLE', 'This merge can no longer be undone.'),
        );
      }
      // Only the latest merge into a card: an earlier one undone under a
      // later would put rows back on a card the later merge has moved on.
      const newer = await repo
        .createQueryBuilder('r')
        .where('r.congregation_id = :t', { t: tenantId })
        .andWhere('r.undone_at IS NULL')
        .andWhere('(r.kept_id = :k OR r.merged_id = :k)', { k: rec.keptId })
        .andWhere('r.id <> :id', { id: rec.id })
        // (A JS date is cut to milliseconds; the row's own time is finer, so
        // without the line above the merge would count as later than itself.)
        .andWhere('r.created_at >= :c', { c: rec.createdAt })
        .getCount();
      if (newer > 0) {
        throw new BadRequestException(
          refusal(
            'MERGE_NOT_UNDOABLE',
            'A later merge involves this card; undo that one first.',
          ),
        );
      }
      const kept = await m.query(
        `SELECT id FROM publishers WHERE id = $1 AND congregation_id = $2 FOR UPDATE`,
        [rec.keptId, tenantId],
      );
      if (kept.length === 0) {
        throw new BadRequestException(
          refusal('MERGE_NOT_UNDOABLE', 'The kept card is gone.'),
        );
      }
      const A = rec.mergedId;
      const B = rec.keptId;
      const acc = payload.accounts;

      // 1. The kept card lets go of a sign-in that came with the merge.
      await m.query(`UPDATE publishers SET user_id = NULL WHERE id = $1`, [B]);

      // 2. The merged card comes back as it was, under the same id.
      await this.insertRow(m, 'publishers', payload.mergedRow);

      // 3. Every row that moved goes back — the ones still on the kept card.
      for (const mv of payload.moved) {
        for (const pk of mv.pks) {
          const where = this.pkWhere(pk, mv.column, B, 2);
          const r: unknown[] = await m.query(
            `UPDATE "${mv.table}" SET "${mv.column}" = $1 WHERE ${where.sql} RETURNING 1`,
            [A, ...where.params],
          );
          if (this.affected(r) === 0) miss(mv.table);
        }
      }
      // 4. What was left out comes back.
      for (const d of payload.dropped) {
        try {
          await m.query('SAVEPOINT merge_undo_row');
          await this.insertRow(m, d.table, d.row);
          await m.query('RELEASE SAVEPOINT merge_undo_row');
        } catch {
          await m.query('ROLLBACK TO SAVEPOINT merge_undo_row');
          miss(d.table);
        }
      }
      // 5. Stored lists of card ids, where nobody touched them since.
      for (const j of payload.json) {
        const where = this.pkWhere(j.pk, null, null, 2);
        const r: unknown[] = await m.query(
          `UPDATE "${j.table}" SET "${j.column}" = $1::jsonb
            WHERE ${where.sql} AND "${j.column}"::jsonb = $${where.params.length + 2}::jsonb
            RETURNING 1`,
          [j.before, ...where.params, j.after],
        );
        if (this.affected(r) === 0) miss(j.table);
      }
      // 6. The kept card's own fields, where they still hold what the merge
      //    wrote; a field changed since stays as it is now.
      {
        const prepo = m.getRepository(Publisher);
        const card = (await prepo.findOne({
          where: { id: B },
          withDeleted: true,
        }))!;
        const bag = card as unknown as Record<string, unknown>;
        let changed = false;
        for (const [k, before] of Object.entries(payload.keptBefore)) {
          const now = JSON.stringify(bag[k] ?? null);
          if (now !== JSON.stringify(payload.keptAfter[k] ?? null)) {
            miss(`publishers.${k}`);
            continue;
          }
          bag[k] =
            DATE_PROPS.has(k) && before ? new Date(before as string) : before;
          changed = true;
        }
        if (changed) await prepo.save(card);
      }
      // 7. Sign-ins as they were.
      await m.query(`UPDATE publishers SET user_id = $1 WHERE id = $2`, [
        acc.keptUserBefore,
        B,
      ]);
      if (acc.closedUserId) {
        await m.query(`UPDATE users SET is_active = $1 WHERE id = $2`, [
          acc.closedWasActive,
          acc.closedUserId,
        ]);
        if (acc.movedResponsibilities.length > 0) {
          await m.query(
            `UPDATE responsibilities SET user_id = $1 WHERE id = ANY($2::uuid[])`,
            [acc.closedUserId, acc.movedResponsibilities],
          );
        }
        for (const row of acc.droppedResponsibilities) {
          await this.insertRow(m, 'responsibilities', row);
        }
      }

      // Undone means «two people after all»: the watcher is not to raise the
      // pair again. Merging them later is still one click on the card.
      const [x, y] = [A, B].sort();
      await m.query(
        `INSERT INTO publisher_distinct_pairs (congregation_id, a_id, b_id, by_user_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [tenantId, x, y, actor.id ?? null],
      );
      rec.undoneAt = new Date();
      rec.payload = null;
      await repo.save(rec);
      return { rec, payload };
    });

    await this.after(tenantId, rec.rec.keptId, actor.id ?? null);
    await this.after(tenantId, rec.rec.mergedId, actor.id ?? null);
    await this.auditLog.logRawUpdate({
      tenantId,
      entityType: 'publisher',
      entityId: rec.rec.keptId,
      actorUserId: actor.id ?? null,
      subjectId: null,
      changedFields: ['mergedWith'],
      before: {
        mergedWith: String(rec.payload.mergedRow['display_name'] ?? ''),
      },
      after: { mergedWith: null },
    });
    if (Object.keys(notReturned).length > 0) {
      this.logger.warn(
        `merge ${mergeId} undone; not returned: ${JSON.stringify(notReturned)}`,
      );
    }
    return { restoredId: rec.rec.mergedId, notReturned };
  }

  /** Thirty days on, a merge is final and its record goes. */
  async expire(now: Date = new Date()): Promise<number> {
    const r = await this.merges.delete({ expiresAt: LessThan(now) });
    return r.affected ?? 0;
  }

  /** Cards merged into this one, still on record — for its history. */
  async mergedInto(tenantId: string, keptId: string): Promise<string[]> {
    const rows = await this.merges.find({
      where: { congregationId: tenantId, keptId, undoneAt: IsNull() },
      select: { mergedId: true },
    });
    return rows.map((r) => r.mergedId);
  }

  // ------------------------------------------------------------- internals

  private async after(
    tenantId: string,
    publisherId: string,
    actorId: string | null,
  ): Promise<void> {
    const card = await this.publishers.findOne({
      where: { id: publisherId, congregationId: tenantId },
      withDeleted: true,
    });
    if (!card) return;
    await this.publishersService
      .recomputeStatus(tenantId, publisherId)
      .catch((e: unknown) =>
        this.logger.warn(`merge: status of ${publisherId}: ${String(e)}`),
      );
    if (card.userId) {
      await this.usersService
        .syncRoleFromAppointment(
          card.userId,
          deriveRoleFromAppointment(card.appointment),
          tenantId,
          actorId ?? undefined,
        )
        .catch((e: unknown) =>
          this.logger.warn(`merge: role of ${card.userId}: ${String(e)}`),
        );
    }
  }

  private defaults(plan: Plan): MergeDecisions {
    const choices: Record<string, string> = {};
    for (const c of plan.view.conflicts) {
      choices[c.key] = c.options.find((o) => o.side === 'kept')!.id;
    }
    return {
      fingerprint: plan.view.fingerprint,
      choices,
      keepUserId: plan.keptCard.userId ?? plan.mergedCard.userId ?? undefined,
    };
  }

  private codeOf(e: unknown): string {
    const r = (e as { response?: { code?: string } })?.response;
    return r?.code ?? 'MERGE_FAILED';
  }

  private readPayload(r: PublisherMerge): MergePayload | null {
    if (!r.payload) return null;
    try {
      return JSON.parse(r.payload) as MergePayload;
    } catch {
      return null;
    }
  }

  private affected(r: unknown[]): number {
    // UPDATE … RETURNING through the pg driver: [rows, count].
    if (Array.isArray(r) && Array.isArray(r[0]))
      return (r[0] as unknown[]).length;
    return Array.isArray(r) ? r.length : 0;
  }

  /** A WHERE for a row by its primary key; `col` swapped to `value`. */
  private pkWhere(
    pk: Pk,
    col: string | null,
    value: string | null,
    from: number,
  ): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(pk)) {
      params.push(k === col ? value : v);
      parts.push(`"${k}"::text = $${from + params.length - 1}::text`);
    }
    return { sql: parts.join(' AND '), params };
  }

  /** Put a row back from its JSON, with the columns the table has today. */
  private async insertRow(
    m: EntityManager,
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const cols: { column_name: string }[] = await m.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    const present = cols
      .map((c) => c.column_name)
      .filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    const list = present.map((c) => `"${c}"`).join(', ');
    await m.query(
      `INSERT INTO "${table}" (${list})
       SELECT ${list} FROM json_populate_record(NULL::"${table}", $1::json)`,
      [JSON.stringify(row)],
    );
  }

  private async rowJson(
    m: EntityManager,
    table: string,
    pk: Pk,
  ): Promise<Record<string, unknown> | null> {
    const where = this.pkWhere(pk, null, null, 1);
    const r: { j: Record<string, unknown> }[] = await m.query(
      `SELECT row_to_json(t) AS j FROM "${table}" t WHERE ${where.sql}`,
      where.params,
    );
    return r[0]?.j ?? null;
  }

  /** Every link to a card the database knows, with each table's key. */
  private async links(m: EntityManager): Promise<Link[]> {
    const fks: { t: string; c: string }[] = await m.query(
      `SELECT c.conrelid::regclass::text AS t, a.attname AS c
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'publishers'::regclass
        ORDER BY 1, 2`,
    );
    const out: Link[] = [];
    for (const fk of fks) {
      const t = fk.t.replace(/^"|"$/g, '');
      const pk: { c: string }[] = await m.query(
        `SELECT a.attname AS c FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary
          ORDER BY a.attnum`,
        [t],
      );
      out.push({ table: t, column: fk.c, pk: pk.map((p) => p.c) });
    }
    return out;
  }

  private async pksOf(
    m: EntityManager,
    link: Link,
    id: string,
    extraSql = '',
  ): Promise<Pk[]> {
    const cols = link.pk.map((c) => `t."${c}"`).join(', ');
    return m.query(
      `SELECT ${cols} FROM "${link.table}" t WHERE t."${link.column}" = $1 ${extraSql}`,
      [id],
    );
  }

  private async facts(
    m: EntityManager,
    tenantId: string,
    p: Publisher,
  ): Promise<MergeCardFacts> {
    const group = p.serviceGroupId
      ? await m.getRepository(ServiceGroup).findOne({
          where: { id: p.serviceGroupId },
          withDeleted: true,
        })
      : null;
    const user = p.userId
      ? await m.getRepository(User).findOne({ where: { id: p.userId } })
      : null;
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM service_reports WHERE publisher_id = $1 AND deleted_at IS NULL`,
      [p.id],
    );
    return {
      id: p.id,
      displayName: p.displayName,
      group: group?.name ?? null,
      appointment: p.appointment,
      gender: p.gender,
      birthDate: p.birthDate ?? null,
      baptismDate: p.baptismDate ?? null,
      memberSince: p.memberSince ?? null,
      createdAt: p.createdAt.toISOString(),
      departed: !!p.deletedAt,
      reports: n,
      account: user
        ? {
            userId: user.id,
            login: user.loginName ?? null,
            lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
          }
        : null,
    };
  }

  private empty(field: Field, v: unknown): boolean {
    if (v === null || v === undefined || v === '') return true;
    if (field === 'pioneerType') return v === PioneerType.NONE;
    if (field === 'spiritualStatus') return v === 'unknown';
    if (field === 'isDeaf' || field === 'isBlind' || field === 'isImprisoned')
      return v === false;
    return false;
  }

  private async plan(
    m: EntityManager,
    tenantId: string,
    keptId: string,
    mergedId: string,
    actor: { id?: string; role?: UserRole },
  ): Promise<Plan> {
    if (keptId === mergedId) {
      throw new BadRequestException(
        refusal('MERGE_SAME_CARD', 'Pick two different cards.'),
      );
    }
    // Both cards locked, always in the same order: two merges at once must
    // not wait on each other for ever.
    const ids = [keptId, mergedId].sort();
    const locked: { id: string }[] = await m.query(
      `SELECT id FROM publishers WHERE congregation_id = $1 AND id = ANY($2::uuid[])
        ORDER BY id FOR UPDATE`,
      [tenantId, ids],
    );
    if (locked.length !== 2) throw new NotFoundException('Publisher not found');
    const repo = m.getRepository(Publisher);
    const keptCard = await repo.findOne({
      where: { id: keptId, congregationId: tenantId },
      withDeleted: true,
    });
    const mergedCard = await repo.findOne({
      where: { id: mergedId, congregationId: tenantId },
      withDeleted: true,
    });
    if (!keptCard || !mergedCard)
      throw new NotFoundException('Publisher not found');

    const blockers: string[] = [];
    // A departed card may be merged into a present one — he came back and was
    // entered anew — but what stays must be a card in use.
    if (keptCard.deletedAt) blockers.push('MERGE_KEPT_DEPARTED');
    // Different people, not a duplicate: merging them would show one the
    // other's reports and contacts.
    if (
      keptCard.birthDate &&
      mergedCard.birthDate &&
      keptCard.birthDate !== mergedCard.birthDate
    )
      blockers.push('MERGE_BIRTH_DATES_DIFFER');
    if (keptCard.gender !== mergedCard.gender)
      blockers.push('MERGE_GENDER_DIFFERS');

    const links = await this.links(m);
    const A = mergedId;
    const B = keptId;
    const autoDrop: { table: string; pk: Pk }[] = [];
    const conflicts: MergeConflict[] = [];
    const conflictRows = new Map<
      string,
      Map<string, { table: string; pk: Pk }[]>
    >();
    const joined: Record<string, number> = {};
    const dropOnce = new Set<string>();
    const addDrop = (table: string, pk: Pk) => {
      const k = `${table}:${JSON.stringify(pk)}`;
      if (dropOnce.has(k)) return;
      dropOnce.add(k);
      autoDrop.push({ table, pk });
      // A mark is not a fact said twice: it goes, but is not «joined».
      if (!DROP_TABLES.has(table)) joined[table] = (joined[table] ?? 0) + 1;
    };

    // Reports: one per month. A deleted row on either side gives way; two
    // live reports are the person's choice.
    const pairs: {
      a: string;
      b: string;
      month: string;
      ad: boolean;
      bd: boolean;
    }[] = await m.query(
      `SELECT a.id AS a, b.id AS b, to_char(a.report_month, 'YYYY-MM') AS month,
              a.deleted_at IS NOT NULL AS ad, b.deleted_at IS NOT NULL AS bd
         FROM service_reports a JOIN service_reports b
           ON b.report_month = a.report_month AND b.publisher_id = $2
        WHERE a.publisher_id = $1
        ORDER BY a.report_month`,
      [A, B],
    );
    for (const p of pairs) {
      if (p.ad) addDrop('service_reports', { id: p.a });
      else if (p.bd) addDrop('service_reports', { id: p.b });
      else {
        const key = `report:${p.month}`;
        const rows: { id: string; side: 'kept' | 'merged' }[] = [
          { id: p.b, side: 'kept' },
          { id: p.a, side: 'merged' },
        ];
        const options: MergeConflictOption[] = [];
        for (const r of rows) {
          const [f] = await m.query(
            `SELECT served_this_month AS served, hours_reported AS hours,
                    bible_studies AS studies, submitted_at AS at
               FROM service_reports WHERE id = $1`,
            [r.id],
          );
          options.push({
            id: r.id,
            side: r.side,
            facts: {
              served: f.served,
              hours: f.hours,
              studies: f.studies,
              submittedAt: f.at ? new Date(f.at).toISOString() : null,
            },
          });
        }
        conflicts.push({ key, kind: 'report', month: p.month, options });
        conflictRows.set(
          key,
          new Map([
            [p.b, [{ table: 'service_reports', pk: { id: p.a } }]],
            [p.a, [{ table: 'service_reports', pk: { id: p.b } }]],
          ]),
        );
      }
    }

    // Pioneer spells and auxiliary months that overlap: one side's stays.
    for (const table of ['pioneer_spells', 'auxiliary_pioneers'] as const) {
      const overlap: { a: string; b: string }[] = await m.query(
        `SELECT a.id AS a, b.id AS b FROM "${table}" a JOIN "${table}" b
            ON b.publisher_id = $2
           AND a.start_month <= COALESCE(b.end_month, DATE '9999-12-01')
           AND b.start_month <= COALESCE(a.end_month, DATE '9999-12-01')
         WHERE a.publisher_id = $1`,
        [A, B],
      );
      if (overlap.length === 0) continue;
      const aIds = [...new Set(overlap.map((o) => o.a))];
      const bIds = [...new Set(overlap.map((o) => o.b))];
      const describe = async (rowIds: string[]) =>
        (await m.query(
          `SELECT to_char(start_month, 'YYYY-MM') AS s, to_char(end_month, 'YYYY-MM') AS e
             FROM "${table}" WHERE id = ANY($1::uuid[]) ORDER BY start_month`,
          [rowIds],
        )) as { s: string; e: string | null }[];
      const say = (r: { s: string; e: string | null }[]) =>
        r.map((x) => `${x.s}…${x.e ?? ''}`).join(', ');
      conflicts.push({
        key: table,
        kind: table,
        month: null,
        options: [
          {
            id: 'kept',
            side: 'kept',
            facts: { months: say(await describe(bIds)) },
          },
          {
            id: 'merged',
            side: 'merged',
            facts: { months: say(await describe(aIds)) },
          },
        ],
      });
      conflictRows.set(
        table,
        new Map([
          ['kept', aIds.map((id) => ({ table, pk: { id } }))],
          ['merged', bIds.map((id) => ({ table, pk: { id } }))],
        ]),
      );
    }

    // Every other one-per-something rule the database keeps: the same cart
    // shift, the same task — the merged card's row is the same fact twice.
    // Plain column indexes only: an expression or a partial index names no
    // simple «same row twice» the merge could resolve.
    const uniques: { t: string; cols: string[] }[] = await m.query(
      `SELECT t.relname AS t,
              array_agg(a.attname::text ORDER BY k.n) AS cols
         FROM pg_index i
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n) ON true
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE i.indisunique
          AND i.indpred IS NULL
          AND NOT (0 = ANY(i.indkey::int2[]))
          AND t.relnamespace = 'public'::regnamespace
        GROUP BY t.relname, i.indexrelid`,
    );
    for (const link of links) {
      if (link.table === 'service_reports' || DROP_TABLES.has(link.table))
        continue;
      for (const u of uniques) {
        if (u.t !== link.table || !u.cols.includes(link.column)) continue;
        const others = u.cols.filter((c) => c !== link.column);
        if (others.length === 0) continue;
        const match = others.map((c) => `b."${c}" = t."${c}"`).join(' AND ');
        // B is the id of the row locked above, not words from a request.
        const pks = await this.pksOf(
          m,
          link,
          A,
          `AND EXISTS (SELECT 1 FROM "${link.table}" b WHERE b."${link.column}" = '${keptCard.id}'::uuid AND ${match})`,
        );
        for (const pk of pks) addDrop(link.table, pk);
      }
    }
    // Marks («these two are different people») are not history.
    for (const link of links) {
      if (!DROP_TABLES.has(link.table)) continue;
      for (const pk of await this.pksOf(m, link, A)) addDrop(link.table, pk);
    }

    const movePks: { link: Link; pks: Pk[] }[] = [];
    const moves: Record<string, number> = {};
    for (const link of links) {
      if (DROP_TABLES.has(link.table)) continue;
      const pks = await this.pksOf(m, link, A);
      if (pks.length === 0) continue;
      movePks.push({ link, pks });
      moves[link.table] = (moves[link.table] ?? 0) + pks.length;
    }

    const fields: MergeFieldDiff[] = [];
    for (const f of FIELDS) {
      const k = keptCard[f] as unknown;
      const v = mergedCard[f] as unknown;
      if (this.empty(f, v)) continue;
      if (this.empty(f, k))
        fields.push({ field: f, kept: k, merged: v, rule: 'take' });
      else if (String(k) !== String(v))
        fields.push({ field: f, kept: k, merged: v, rule: 'choose' });
    }

    const accounts: MergePlanView['accounts'] = mergedCard.userId
      ? keptCard.userId
        ? 'choose'
        : 'move'
      : 'none';

    // A sent month that counted both cards as two people: said, not changed.
    // (Inside the transaction a failed query would spoil everything after
    // it, so this one must not fail: only arrays are asked.)
    const twice: { m: string }[] = await m.query(
      `SELECT DISTINCT s.period AS m
         FROM report_snapshots s, jsonb_each(s.members) e
        WHERE s.congregation_id = $1
          AND jsonb_typeof(e.value) = 'array'
          AND e.value ? $2 AND e.value ? $3
        ORDER BY 1`,
      [tenantId, A, B],
    );

    // Somebody already said these two are different people (or undid their
    // merge): not a stop — names get mistyped — but said before the button.
    const [x, y] = [keptId, mergedId].sort();
    const markedDistinct =
      (
        (await m.query(
          `SELECT 1 FROM publisher_distinct_pairs WHERE a_id = $1 AND b_id = $2`,
          [x, y],
        )) as unknown[]
      ).length > 0;

    const core = {
      keptId,
      mergedId,
      keptAt: keptCard.updatedAt?.toISOString(),
      mergedAt: mergedCard.updatedAt?.toISOString(),
      movePks: movePks.map((x) => [x.link.table, x.link.column, x.pks]),
      autoDrop,
      conflicts: conflicts.map((c) => [c.key, c.options.map((o) => o.id)]),
      fields: fields.map((f) => [
        f.field,
        f.rule,
        createHash('sha256')
          .update(`${String(f.kept)}|${String(f.merged)}`)
          .digest('hex'),
      ]),
      users: [keptCard.userId, mergedCard.userId],
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(core))
      .digest('hex')
      .slice(0, 32);

    const view: MergePlanView = {
      kept: await this.facts(m, tenantId, keptCard),
      merged: await this.facts(m, tenantId, mergedCard),
      moves,
      joined,
      conflicts,
      fields,
      accounts,
      needsAdmin: accounts !== 'none',
      countedTwice: twice.map((t) => t.m),
      markedDistinct,
      blockers,
      fingerprint,
    };
    void actor;
    return {
      view,
      links,
      movePks,
      autoDrop,
      conflictRows,
      keptCard,
      mergedCard,
    };
  }

  private async execute(
    m: EntityManager,
    tenantId: string,
    plan: Plan,
    d: MergeDecisions,
    actor: { id?: string; role?: UserRole },
  ): Promise<{
    mergeId: string;
    summary: Record<string, number>;
    payload: MergePayload;
  }> {
    const A = plan.mergedCard.id;
    const B = plan.keptCard.id;
    const payload: MergePayload = {
      v: 1,
      mergedRow: (await this.rowJson(m, 'publishers', { id: A }))!,
      keptBefore: {},
      keptAfter: {},
      moved: [],
      dropped: [],
      json: [],
      accounts: {
        keptUserBefore: plan.keptCard.userId ?? null,
        mergedUserBefore: plan.mergedCard.userId ?? null,
        closedUserId: null,
        closedWasActive: false,
        movedResponsibilities: [],
        droppedResponsibilities: [],
      },
    };
    const propsOf = (p: Publisher) =>
      Object.fromEntries(
        KEPT_PROPS.map((k) => [
          k,
          JSON.parse(
            JSON.stringify(
              (p as unknown as Record<string, unknown>)[k] ?? null,
            ),
          ) as unknown,
        ]),
      );
    const keptPropsBefore = propsOf(plan.keptCard);

    // 1. What gives way: duplicates, and the side not chosen.
    const drops = [...plan.autoDrop];
    for (const c of plan.view.conflicts) {
      const chosen = d.choices?.[c.key];
      const byOption = plan.conflictRows.get(c.key)!;
      if (!chosen || !byOption.has(chosen)) {
        throw new BadRequestException(
          refusal('MERGE_CHOICE_MISSING', `Choose for ${c.key}.`),
        );
      }
      drops.push(...byOption.get(chosen)!);
    }
    for (const dr of drops) {
      const row = await this.rowJson(m, dr.table, dr.pk);
      if (!row) continue;
      payload.dropped.push({ table: dr.table, row });
      const where = this.pkWhere(dr.pk, null, null, 1);
      await m.query(
        `DELETE FROM "${dr.table}" WHERE ${where.sql}`,
        where.params,
      );
    }

    // 2. The sign-in leaves the merged card first: one card per sign-in.
    await m.query(`UPDATE publishers SET user_id = NULL WHERE id = $1`, [A]);

    // 3. Every link moves to the kept card.
    const summary: Record<string, number> = {};
    for (const link of plan.links) {
      if (DROP_TABLES.has(link.table)) continue;
      const pks = await this.pksOf(m, link, A);
      if (pks.length === 0) continue;
      await m.query(
        `UPDATE "${link.table}" SET "${link.column}" = $2 WHERE "${link.column}" = $1`,
        [A, B],
      );
      payload.moved.push({
        table: link.table,
        column: link.column,
        // Keys as they are now, after the move (the column may be in the key).
        pks: pks.map((pk) =>
          link.pk.includes(link.column) ? { ...pk, [link.column]: B } : pk,
        ),
      });
      summary[link.table] = (summary[link.table] ?? 0) + pks.length;
    }

    // 4. Card ids kept inside stored lists (the sent month's members, the
    //    meeting run): rewritten, and remembered as they were.
    const jsonCols: { t: string; c: string; dt: string }[] = await m.query(
      `SELECT table_name AS t, column_name AS c, data_type AS dt
         FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type IN ('jsonb', 'json')`,
    );
    for (const jc of jsonCols) {
      if (SCAN_EXCLUDED.has(jc.t)) continue;
      const pkCols: { c: string }[] = await m.query(
        `SELECT a.attname AS c FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary`,
        [jc.t],
      );
      if (pkCols.length === 0) continue;
      const sel = pkCols.map((p) => `"${p.c}"`).join(', ');
      const rows: (Pk & { __v: string })[] = await m.query(
        `SELECT ${sel}, "${jc.c}"::text AS __v FROM "${jc.t}"
          WHERE "${jc.c}"::text LIKE '%' || $1 || '%'`,
        [A],
      );
      for (const r of rows) {
        const { __v, ...pk } = r;
        const after = __v.split(A).join(B);
        const where = this.pkWhere(pk, null, null, 2);
        await m.query(
          `UPDATE "${jc.t}" SET "${jc.c}" = $1::${jc.dt} WHERE ${where.sql}`,
          [after, ...where.params],
        );
        payload.json.push({
          table: jc.t,
          column: jc.c,
          pk,
          before: __v,
          after,
        });
      }
    }

    // 5. The kept card's own fields.
    const kept = await m
      .getRepository(Publisher)
      .findOne({ where: { id: B }, withDeleted: true });
    const merged = plan.mergedCard;
    let contactsTaken = false;
    for (const f of plan.view.fields) {
      const take = f.rule === 'take' || d.fields?.[f.field] === 'merged';
      if (!take) continue;
      (kept as unknown as Record<string, unknown>)[f.field] = merged[f.field];
      if (CONTACT_FIELDS.includes(f.field)) contactsTaken = true;
    }
    if (contactsTaken) {
      kept!.contactsConfirmedAt = merged.contactsConfirmedAt ?? null;
      kept!.contactsConfirmedByUserId =
        merged.contactsConfirmedByUserId ?? null;
    }
    // Here since the earlier of the two; «as long as our records go» wins.
    if (
      kept!.memberSince &&
      (!merged.memberSince || merged.memberSince < kept!.memberSince)
    )
      kept!.memberSince = merged.memberSince ?? null;
    kept!.capabilities = {
      ...(merged.capabilities ?? {}),
      ...(kept!.capabilities ?? {}),
    };
    for (const [k, v] of Object.entries(merged.capabilities ?? {}))
      if (v === true) kept!.capabilities[k] = true;
    kept!.publicTalkNumbers = [
      ...new Set([
        ...(kept!.publicTalkNumbers ?? []),
        ...(merged.publicTalkNumbers ?? []),
      ]),
    ].sort((a, b) => a - b);
    kept!.displayName = [kept!.lastName, kept!.firstName, kept!.middleName]
      .filter(Boolean)
      .join(' ');

    // 6. Sign-ins.
    const users = m.getRepository(User);
    let finalUser: string | null = kept!.userId ?? null;
    if (plan.view.accounts === 'move') {
      finalUser = merged.userId;
    } else if (plan.view.accounts === 'choose') {
      const keep = d.keepUserId;
      if (keep !== merged.userId && keep !== kept!.userId) {
        throw new BadRequestException(
          refusal('MERGE_CHOICE_MISSING', 'Choose which sign-in stays.'),
        );
      }
      const closing = keep === merged.userId ? kept!.userId! : merged.userId!;
      const account = await users.findOne({ where: { id: closing } });
      if (account) {
        await this.assertClosable(m, tenantId, account, actor.id);
        payload.accounts.closedUserId = account.id;
        payload.accounts.closedWasActive = account.isActive;
        await users.update(account.id, { isActive: false });
        await m.getRepository(RefreshSession).delete({ userId: account.id });
        const resp = m.getRepository(Responsibility);
        const held = await resp.find({
          where: { congregationId: tenantId, userId: account.id },
        });
        const has = new Set(
          (
            await resp.find({
              where: { congregationId: tenantId, userId: keep },
            })
          ).map((r) => r.type),
        );
        for (const r of held) {
          if (has.has(r.type)) {
            payload.accounts.droppedResponsibilities.push(
              (await this.rowJson(m, 'responsibilities', { id: r.id }))!,
            );
            await resp.delete(r.id);
          } else {
            await resp.update(r.id, { userId: keep! });
            payload.accounts.movedResponsibilities.push(r.id);
          }
        }
      }
      finalUser = keep ?? null;
    }
    kept!.userId = null;
    await m.getRepository(Publisher).save(kept!);
    if (finalUser) {
      await m.query(`UPDATE publishers SET user_id = $1 WHERE id = $2`, [
        finalUser,
        B,
      ]);
    }

    const keptPropsAfter = propsOf(
      (await m
        .getRepository(Publisher)
        .findOne({ where: { id: B }, withDeleted: true }))!,
    );
    for (const k of KEPT_PROPS) {
      if (
        JSON.stringify(keptPropsBefore[k]) !== JSON.stringify(keptPropsAfter[k])
      ) {
        payload.keptBefore[k] = keptPropsBefore[k];
        payload.keptAfter[k] = keptPropsAfter[k];
      }
    }

    // 7. Nothing may still name the merged card. The whole database is asked
    //    — not the list of links — so a forgotten place stops the merge here
    //    instead of turning into a dangling id.
    const left = await this.stillNaming(m, A);
    if (left.length > 0) {
      this.logger.error(`merge ${B}<-${A}: still named in ${left.join(', ')}`);
      throw new ConflictException(
        refusal(
          'MERGE_SELF_CHECK',
          `Merge stopped: the card is still named in ${left.join(', ')}`,
        ),
      );
    }

    await m.query(`DELETE FROM publishers WHERE id = $1`, [A]);

    const rec = await m.getRepository(PublisherMerge).save(
      m.getRepository(PublisherMerge).create({
        congregationId: tenantId,
        keptId: B,
        mergedId: A,
        byUserId: actor.id ?? null,
        expiresAt: new Date(Date.now() + MERGE_UNDO_DAYS * 86_400_000),
        summary,
        payload: JSON.stringify(payload),
      }),
    );
    return { mergeId: rec.id, summary, payload };
  }

  private async assertClosable(
    m: EntityManager,
    tenantId: string,
    account: User,
    actorId?: string,
  ): Promise<void> {
    if (actorId && account.id === actorId) {
      throw new ForbiddenException(
        refusal(
          'OWN_DEACTIVATION',
          'You cannot close the sign-in you are using',
        ),
      );
    }
    if (account.isOwner) {
      throw new ForbiddenException(
        refusal('OWNER_PROTECTED', 'The owner account cannot be deactivated'),
      );
    }
    if (account.role === UserRole.ADMIN) {
      const admins = await m.getRepository(User).count({
        where: {
          congregationId: tenantId,
          role: UserRole.ADMIN,
          isActive: true,
        },
      });
      if (admins <= 1) {
        throw new ForbiddenException(
          refusal(
            'LAST_ACTIVE_ADMIN',
            'Cannot deactivate the last active admin in this congregation',
          ),
        );
      }
    }
  }

  /** Every table but the journal, searched for the id as text. */
  private async stillNaming(m: EntityManager, id: string): Promise<string[]> {
    const tables: { t: string }[] = await m.query(
      `SELECT c.relname AS t FROM pg_class c
        WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
        ORDER BY 1`,
    );
    const out: string[] = [];
    for (const { t } of tables) {
      if (SCAN_EXCLUDED.has(t)) continue;
      const extra = t === 'publishers' ? ` AND x."id" <> $1::uuid` : '';
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM "${t}" x WHERE x::text LIKE '%' || $1 || '%'${extra}`,
        [id],
      );
      if (n > 0) out.push(t);
    }
    return out;
  }

  // ------------------------------------------------------------ duplicates

  /**
   * Cards that may be the same person as the one being entered: the same
   * first and last name (case, spaces and ё/е aside, in either order), the
   * same address or the same phone. Departed cards too — he may have come
   * back. Read in memory: contacts are encrypted at rest.
   */
  async duplicates(
    tenantId: string,
    q: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      exceptId?: string;
    },
  ): Promise<
    {
      id: string;
      displayName: string;
      group: string | null;
      departed: boolean;
      memberSince: string | null;
      createdAt: string;
      /** What tells two cards of one name apart in the picker. */
      reports: number;
      hasAccount: boolean;
      why: ('name' | 'email' | 'phone')[];
    }[]
  > {
    const probe = {
      firstName: q.firstName,
      lastName: q.lastName,
      email: q.email,
      mobilePhone: q.phone,
    };
    if (
      !nameKey(q.firstName, q.lastName) &&
      !emailKey(q.email) &&
      !phoneKey(q.phone)
    )
      return [];
    const cards = await this.publishers.find({
      where: { congregationId: tenantId },
      withDeleted: true,
      relations: { serviceGroup: true },
    });
    const out: Awaited<ReturnType<CardMergeService['duplicates']>> = [];
    for (const c of cards) {
      if (c.id === q.exceptId) continue;
      const why = alike(probe, c);
      if (why.length === 0) continue;
      out.push({
        id: c.id,
        displayName: c.displayName,
        group: c.serviceGroup?.name ?? null,
        departed: !!c.deletedAt,
        memberSince: c.memberSince ?? null,
        createdAt: c.createdAt.toISOString(),
        reports: (
          (await this.publishers.manager.query(
            `SELECT count(*)::int AS n FROM service_reports WHERE publisher_id = $1 AND deleted_at IS NULL`,
            [c.id],
          )) as { n: number }[]
        )[0].n,
        hasAccount: !!c.userId,
        why,
      });
    }
    return out;
  }

  /** For a stale screen sending a merged card's id: where it went. */
  async whereMerged(tenantId: string, ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;
    return (
      (await this.merges.count({
        where: {
          congregationId: tenantId,
          mergedId: In(ids),
          undoneAt: IsNull(),
        },
      })) > 0
    );
  }
}
