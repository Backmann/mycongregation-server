import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { ServerErrors, type ServerErrorLine } from './server-errors';

/** The failures since start, by route and kind — administrators only. */
@Controller('health/errors')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class ServerErrorsController {
  constructor(private readonly errors: ServerErrors) {}

  @Get()
  list(): { since: string; total: number; lines: ServerErrorLine[] } {
    return {
      since: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      total: this.errors.count(),
      lines: this.errors.list(),
    };
  }
}
