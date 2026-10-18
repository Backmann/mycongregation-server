import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ConductLiveService } from './conduct-live.service';
import { conductKind } from '../common/conduct-kind';
import {
  TakeConductLiveDto,
  WriteConductLiveDto,
} from './dto/conduct-live.dto';

/**
 * A midweek meeting while it runs. Who may read, write and take over is
 * decided in the service against that week's programme and duties — no role
 * here: the timekeeper may be any brother the duties name, a publisher too.
 *
 * Every answer carries `serverNow`, the clock the run's times are kept in.
 */
@Controller('conduct-live')
@UseGuards(RolesGuard)
export class ConductLiveController {
  constructor(private readonly service: ConductLiveService) {}

  @Get()
  async find(
    @CurrentUser() user: AuthenticatedUser,
    @Query('week') week: string,
    @Query('kind') kind?: string,
  ) {
    const { live, roles } = await this.service.find(
      user,
      week,
      new Date(),
      conductKind(kind),
    );
    return { live, roles, serverNow: new Date().toISOString() };
  }

  @Put()
  async write(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: WriteConductLiveDto,
  ) {
    const live = await this.service.write(
      user,
      dto.weekStartDate,
      dto.epoch,
      dto.state,
      new Date(),
      conductKind(dto.eventType),
    );
    return { live, serverNow: new Date().toISOString() };
  }

  @Post('take')
  async take(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TakeConductLiveDto,
  ) {
    const live = await this.service.take(
      user,
      dto.weekStartDate,
      dto.state,
      new Date(),
      conductKind(dto.eventType),
    );
    return { live, serverNow: new Date().toISOString() };
  }
}
