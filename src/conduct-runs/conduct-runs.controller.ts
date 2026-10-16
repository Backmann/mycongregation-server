import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ConductRunsService } from './conduct-runs.service';
import { SaveConductRunDto } from './dto/save-conduct-run.dto';

/**
 * How a midweek meeting ran — saved by whoever ran it when he finishes, read
 * for seven days by the admins, the counsel brother and the Life and
 * Ministry overseer. Who may do which is decided in the service, against
 * that week's programme and the reader's responsibilities — no role here:
 * the counsel brother is known by his responsibility, which a role guard
 * cannot see.
 */
@Controller('conduct-runs')
@UseGuards(RolesGuard)
export class ConductRunsController {
  constructor(private readonly service: ConductRunsService) {}

  @Get()
  async find(
    @CurrentUser() user: AuthenticatedUser,
    @Query('week') week: string,
  ) {
    // An object, never a bare null: «no run» is an answer, not an empty body.
    return { run: await this.service.find(user, week) };
  }

  // No role here: the timekeeper who ends the meeting may be any brother the
  // duties name, a publisher too. The service checks the week's programme
  // and duties.
  @Put()
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveConductRunDto) {
    return this.service.save(user, dto);
  }
}
