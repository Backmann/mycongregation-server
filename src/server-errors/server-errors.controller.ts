import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { ServerErrors, type ServerErrorLine } from './server-errors';
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

  @Get()
  list(): {
    since: string;
    /** TypeORM 1.x's rule for an empty where value: on (`throw`) or not. */
    whereRule: WhereValuesMode;
    total: number;
    truncated: boolean;
    lines: ServerErrorLine[];
  } {
    return {
      since: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      whereRule: whereValuesMode(),
      total: this.errors.count(),
      truncated: this.errors.truncated(),
      lines: this.errors.list(),
    };
  }
}
