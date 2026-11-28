import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  Not,
} from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { todayIn } from '../common/congregation-clock';
import { RETENTION_RULES, RetentionRule, cutoffDate } from './retention-rules';

export interface RetentionPreviewRow {
  key: string;
  what: string;
  basis: string;
  /** Records dated before this day (or deleted before it) are past their time. */
  before: string;
  count: number;
  cascades?: string[];
  caution?: string;
  /** What stays whatever its age, in plain words. */
  kept?: string;
  /** What removal will do once switched on, where it is not plain deletion. */
  does?: 'anonymise' | 'delete';
  /** Switched on: done every night, not only counted. */
  on?: boolean;
}

/**
 * Counts what the retention rules would remove (31 October 2026).
 *
 * The counts are looked at first — on the live data, through
 * `GET /retention/preview` and the night log — and only then is removal
 * switched on, in a change of its own, rule by rule (`apply`). A rule that
 * deletes on the first night after it ships has never been seen doing it.
 * Switched on so far: the S-13's names and lines (17 November 2026).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async preview(
    congregationId: string,
    now: Date = new Date(),
  ): Promise<RetentionPreviewRow[]> {
    const congregation = await this.dataSource
      .getRepository(Congregation)
      .findOne({ where: { id: congregationId } });
    const today = todayIn(now, congregation?.timezone);
    const rows: RetentionPreviewRow[] = [];
    for (const rule of RETENTION_RULES) {
      if (rule.kind === 'counted') {
        const before = rule.keptFrom(today);
        rows.push({
          key: rule.key,
          what: rule.what,
          basis: rule.basis,
          before,
          count: await rule.count(this.dataSource, congregationId, before),
          does: rule.does,
          ...(rule.apply ? { on: true } : {}),
        });
        continue;
      }
      const before = cutoffDate(today, rule.keep);
      rows.push({
        key: rule.key,
        what: rule.what,
        basis: rule.basis,
        before,
        count: await this.countPast(rule, congregationId, before),
        ...(rule.kind === 'dated' && rule.cascades
          ? { cascades: rule.cascades }
          : {}),
        ...(rule.kind === 'soft-deleted' && rule.caution
          ? { caution: rule.caution }
          : {}),
        ...(rule.kind === 'soft-deleted' && rule.kept
          ? { kept: rule.kept }
          : {}),
        ...(rule.on ? { on: true, does: 'delete' as const } : {}),
      });
    }
    return rows;
  }

  private async countPast(
    rule: Exclude<RetentionRule, { kind: 'counted' }>,
    congregationId: string,
    before: string,
  ): Promise<number> {
    const repo = this.dataSource.getRepository(rule.entity);
    // Built as find options, not SQL text: the property names come from the
    // rule list and TypeORM maps them to columns itself.
    return repo.count({
      where: await this.pastWhere(rule, congregationId, before),
      withDeleted: true,
    });
  }

  /**
   * The rows past their time — the same condition for counting and removing.
   * Several objects are joined with OR, each one complete.
   */
  private async pastWhere(
    rule: Exclude<RetentionRule, { kind: 'counted' }>,
    congregationId: string,
    before: string,
  ): Promise<FindOptionsWhere<object>[]> {
    if (rule.kind === 'dated') {
      const base: Record<string, unknown> = { congregationId };
      for (const [key, value] of Object.entries(rule.only ?? {}))
        base[key] = value;
      const dated = { ...base, [rule.column]: LessThan(before) };
      if (!rule.emptyMeans) return [dated as FindOptionsWhere<object>];
      return [
        dated,
        {
          ...base,
          [rule.column]: IsNull(),
          [rule.emptyMeans]: LessThan(before),
        },
      ] as FindOptionsWhere<object>[];
    }
    // `<` is never true for NULL, so rows that were never deleted stay out.
    const held = rule.heldIds
      ? await rule.heldIds(this.dataSource, congregationId)
      : [];
    return [
      {
        ...(rule.keepWhile ?? {}),
        ...(held.length > 0 ? { id: Not(In(held)) } : {}),
        congregationId,
        deletedAt: LessThan(before),
      } as FindOptionsWhere<object>,
    ];
  }

  /**
   * The switched-on dated and soft-deleted rules (R-20, 28 November 2026):
   * the rows past their time go for good — one statement per rule, the
   * database taking what hangs on them (ON DELETE CASCADE / SET NULL, listed
   * per rule). A soft-deleted row is erased, not deleted again: the query
   * builder's delete is the real one. Returns how many rows each removed.
   */
  async applyDated(
    congregationId: string,
    now: Date = new Date(),
  ): Promise<Record<string, number>> {
    const congregation = await this.dataSource
      .getRepository(Congregation)
      .findOne({ where: { id: congregationId } });
    const today = todayIn(now, congregation?.timezone);
    const done: Record<string, number> = {};
    for (const rule of RETENTION_RULES) {
      if (rule.kind === 'counted' || !rule.on) continue;
      const before = cutoffDate(today, rule.keep);
      // One rule failing is told and the next still acts.
      try {
        const res = await this.dataSource
          .createQueryBuilder()
          .delete()
          .from(rule.entity)
          .where(await this.pastWhere(rule, congregationId, before))
          .execute();
        done[rule.key] = res.affected ?? 0;
      } catch (err) {
        this.logger.error(`retention ${rule.key} failed: ${errorKind(err)}`);
      }
    }
    return done;
  }

  /**
   * What the switched-on rules do, for one congregation: one rule after
   * another, each in its own statement or transaction. Returns how many rows
   * each touched.
   */
  async applyCounted(
    congregationId: string,
    now: Date = new Date(),
  ): Promise<Record<string, number>> {
    const congregation = await this.dataSource
      .getRepository(Congregation)
      .findOne({ where: { id: congregationId } });
    const today = todayIn(now, congregation?.timezone);
    const done: Record<string, number> = {};
    for (const rule of RETENTION_RULES) {
      if (rule.kind !== 'counted' || !rule.apply) continue;
      done[rule.key] = await rule.apply(
        this.dataSource,
        congregationId,
        rule.keptFrom(today),
      );
    }
    return done;
  }

  /**
   * Every night, before the counts: the switched-on rules act. The log says
   * how many rows, never which.
   */
  @Cron('45 2 * * *', { name: 'retention-apply', timeZone: 'UTC' })
  async applyNightly(): Promise<void> {
    try {
      const congregations = await this.dataSource
        .getRepository(Congregation)
        .find({ select: { id: true } });
      const totals = new Map<string, number>();
      // One congregation failing is told and the next still acts.
      for (const c of congregations) {
        const steps: [string, () => Promise<Record<string, number>>][] = [
          ['applyCounted', () => this.applyCounted(c.id)],
          ['applyDated', () => this.applyDated(c.id)],
        ];
        for (const [name, step] of steps) {
          try {
            for (const [key, n] of Object.entries(await step())) {
              totals.set(key, (totals.get(key) ?? 0) + n);
            }
          } catch (err) {
            this.logger.error(`retention ${name} failed: ${errorKind(err)}`);
          }
        }
      }
      const done = [...totals].filter(([, n]) => n > 0);
      this.logger.log(
        done.length === 0
          ? 'retention: nothing past its time'
          : `retention done: ${done.map(([k, n]) => `${k}=${n}`).join(' ')}`,
      );
    } catch (err) {
      this.logger.error(`retention failed: ${errorKind(err)}`);
    }
  }

  /**
   * Every night: the counts per rule, summed over congregations, numbers
   * only. No names, no ids — the log is read by whoever looks at the server.
   */
  @Cron('55 2 * * *', { name: 'retention-preview', timeZone: 'UTC' })
  async logPreview(): Promise<void> {
    try {
      const congregations = await this.dataSource
        .getRepository(Congregation)
        .find({ select: { id: true } });
      const totals = new Map<string, number>();
      // One congregation failing is told and the next is still counted.
      for (const c of congregations) {
        try {
          for (const row of await this.preview(c.id)) {
            totals.set(row.key, (totals.get(row.key) ?? 0) + row.count);
          }
        } catch (err) {
          this.logger.error(`retention preview failed: ${errorKind(err)}`);
        }
      }
      const due = [...totals].filter(([, n]) => n > 0);
      this.logger.log(
        due.length === 0
          ? 'retention preview: nothing past its time'
          : `retention preview (still kept or not switched on): ${due
              .map(([key, n]) => `${key}=${n}`)
              .join(' ')}`,
      );
    } catch (err) {
      this.logger.error(`retention preview failed: ${errorKind(err)}`);
    }
  }
}

/**
 * The kind of a failure for the log: the class and the database's own code
 * (23503 is a foreign key) — never the message, which may quote a row.
 */
export function errorKind(err: unknown): string {
  const name = (err as Error)?.constructor?.name ?? typeof err;
  const code = (err as { driverError?: { code?: unknown } })?.driverError?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
    ? `${name} ${code}`
    : name;
}
