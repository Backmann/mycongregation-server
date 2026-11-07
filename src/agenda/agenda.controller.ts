import { Controller, Get, Query } from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AgendaService } from './agenda.service';
import { AgendaQueryDto } from './dto/agenda-query.dto';

/**
 * The signed-in person's own agenda (agenda.types.ts). Any login may ask for
 * its own and nobody else's: the publisher is the one linked to the login.
 */
@Controller('me')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('agenda')
  mine(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: AgendaQueryDto,
  ) {
    return this.agenda.forUser(tenantId, user.id, { from: q.from, to: q.to });
  }
}
