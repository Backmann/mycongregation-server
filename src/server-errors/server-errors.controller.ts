import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { KEEP_DAYS, ServerErrors, type ServerErrorLine } from './server-errors';
import { whereValuesMode, type WhereValuesMode } from '../common/where-values';

/**
 * The failures since start, by route and kind — the platform owner only: they
 * span every congregation on the server (independent check).
 */
@Controller('health/errors')
@UseGuards(RolesGuard, PlatformOwnerGuard)
@Roles(UserRole.ADMIN)
export class ServerErrorsController {
  constructor(private readonly errors: ServerErrors) {}

  /**
   * ?days=N (1–30, default 14): what the table kept over the last days,
   * across restarts and deploys (28 November 2026). If the table cannot be
   * read, the answer is this process's own count, and `source` says so.
   */
  @Get()
  async list(@Query('days') daysRaw?: string): Promise<{
    since: string;
    /** When this server process started — the memory count begins there. */
    startedAt: string;
    /** «table»: kept across restarts; «memory»: since this process started. */
    source: 'table' | 'memory';
    /** TypeORM 1.x's rule for an empty where value: on (`throw`) or not. */
    whereRule: WhereValuesMode;
    total: number;
    truncated: boolean;
    lines: ServerErrorLine[];
  }> {
    const n = Number.parseInt(daysRaw ?? '', 10);
    const days = Number.isFinite(n) ? Math.min(KEEP_DAYS, Math.max(1, n)) : 14;
    const startedAt = new Date(
      Date.now() - process.uptime() * 1000,
    ).toISOString();
    const kept = await this.errors.kept(days);
    if (kept) {
      return {
        since: kept.since,
        startedAt,
        source: 'table',
        whereRule: whereValuesMode(),
        total: kept.total,
        truncated: kept.truncated,
        lines: kept.lines,
      };
    }
    return {
      since: startedAt,
      startedAt,
      source: 'memory',
      whereRule: whereValuesMode(),
      total: this.errors.count(),
      truncated: this.errors.truncated(),
      lines: this.errors.list(),
    };
  }
}
