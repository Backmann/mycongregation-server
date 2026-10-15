import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { ConductRunsService } from './conduct-runs.service';
import { SaveConductRunDto } from './dto/save-conduct-run.dto';

/**
 * How a midweek meeting ran — saved by its chairman when he finishes, read by
 * him and the elders for seven days. Who may do which is decided in the
 * service, against that week's programme; the roles below only keep a
 * publisher's request from reaching it (the chairman is an elder or, where
 * there are few, a ministerial servant).
 */
@Controller('conduct-runs')
@UseGuards(RolesGuard)
export class ConductRunsController {
  constructor(private readonly service: ConductRunsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
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
