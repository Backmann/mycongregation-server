import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, LessThan } from 'typeorm';
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
}

/**
 * Counts what the retention rules would remove (31 October 2026).
 *
 * PREVIEW ONLY. Nothing here deletes. The counts are looked at first — on the
 * live data, through `GET /retention/preview` and the night log — and only
 * then is removal switched on, in a change of its own. A rule that deletes on
 * the first night after it ships has never been seen doing it.
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
      });
    }
    return rows;
  }

  private async countPast(
    rule: RetentionRule,
    congregationId: string,
    before: string,
  ): Promise<number> {
    const repo = this.dataSource.getRepository(rule.entity);
    // Built as find options, not SQL text: the property names come from the
    // rule list and TypeORM maps them to columns itself.
    const where: Record<string, unknown> = { congregationId };
    if (rule.kind === 'dated') {
      where[rule.column] = LessThan(before);
      for (const [key, value] of Object.entries(rule.only ?? {}))
        where[key] = value;
    } else {
      // `<` is never true for NULL, so rows that were never deleted stay out.
      where.deletedAt = LessThan(before);
    }
    return repo.count({
      where: where as FindOptionsWhere<object>,
      withDeleted: true,
    });
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
      for (const c of congregations) {
        for (const row of await this.preview(c.id)) {
          totals.set(row.key, (totals.get(row.key) ?? 0) + row.count);
        }
      }
      const due = [...totals].filter(([, n]) => n > 0);
      this.logger.log(
        due.length === 0
          ? 'retention preview: nothing past its time'
          : `retention preview (nothing deleted): ${due
              .map(([key, n]) => `${key}=${n}`)
              .join(' ')}`,
      );
    } catch (err) {
      this.logger.error(`retention preview failed: ${String(err)}`);
    }
  }
}
