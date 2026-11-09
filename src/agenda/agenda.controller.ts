import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AgendaService } from './agenda.service';
import { AgendaSeenService } from './agenda-seen.service';
import { AgendaQueryDto } from './dto/agenda-query.dto';

/**
 * The signed-in person's own agenda (agenda.types.ts). Any login may ask for
 * its own and nobody else's: the publisher is the one linked to the login.
 */
@Controller('me')
export class AgendaController {
  constructor(
    private readonly agenda: AgendaService,
    private readonly seen: AgendaSeenService,
  ) {}

  @Get('agenda')
  mine(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: AgendaQueryDto,
  ) {
    return this.agenda.forUser(tenantId, user.id, { from: q.from, to: q.to });
  }

  /** What changed in one's own coming items since Home was last seen. */
  @Get('agenda/changes')
  changes(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.seen.changes(tenantId, user.id);
  }

  /** Home was seen: the marks go out. */
  @Post('agenda/seen')
  @HttpCode(200)
  markSeen(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.seen.markSeen(tenantId, user.id);
  }
}
