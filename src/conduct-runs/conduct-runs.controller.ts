import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ConductRunsService } from './conduct-runs.service';
import { ConductAveragesService } from './conduct-averages.service';
import { StageAllowed } from '../common/stage';
import { SaveConductRunDto } from './dto/save-conduct-run.dto';
import { conductKind } from '../common/conduct-kind';

/**
 * How a midweek meeting ran — saved by whoever ran it when he finishes, read
 * through the 4th day after the meeting by the admins, the counsel brother and the Life and
 * Ministry overseer. Who may do which is decided in the service, against
 * that week's programme and the reader's responsibilities — no role here:
 * the counsel brother is known by his responsibility, which a role guard
 * cannot see.
 */
@Controller('conduct-runs')
@UseGuards(RolesGuard)
export class ConductRunsController {
  constructor(
    private readonly service: ConductRunsService,
    private readonly averagesService: ConductAveragesService,
  ) {}

  /**
   * What finished meetings taught the forecast (R-76): four middle numbers
   * in seconds and how many meetings stand behind them — no names, no
   * results. Read by the screens that run or show a meeting, the stage's too.
   */
  @StageAllowed()
  @Get('averages')
  async averages(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind?: string,
  ) {
    return {
      averages: await this.averagesService.read(
        user.congregationId,
        conductKind(kind),
      ),
    };
  }

  @Get()
  async find(
    @CurrentUser() user: AuthenticatedUser,
    @Query('week') week: string,
    @Query('kind') kind?: string,
  ) {
    // An object, never a bare null: «no run» is an answer, not an empty body.
    return {
      run: await this.service.find(user, week, new Date(), conductKind(kind)),
    };
  }

  // No role here: the timekeeper who ends the meeting may be any brother the
  // duties name, a publisher too. The service checks the week's programme
  // and duties.
  @Put()
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveConductRunDto) {
    return this.service.save(user, dto);
  }

  /** «Это была проба»: the result and the run of that week go, until its day is over. */
  @Delete()
  drop(
    @CurrentUser() user: AuthenticatedUser,
    @Query('week') week: string,
    @Query('kind') kind?: string,
  ) {
    return this.service.drop(user, week, conductKind(kind));
  }
}
