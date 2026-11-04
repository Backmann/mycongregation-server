import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import type { MeetingKind } from '../common/week-rules';
import { MoveMeetingDto } from './dto/move-meeting.dto';
import { MeetingMovesService } from './meeting-moves.service';
import { StageAllowed } from '../common/stage';

/**
 * A meeting moved for one week (4 November 2026). Reading is for every
 * member — the app's week rules need the moves to show the right day; who
 * may move is decided in the service, per meeting.
 */
@Controller('meeting-moves')
export class MeetingMovesController {
  constructor(private readonly service: MeetingMovesService) {}

  // The stage screen in the hall reads it too (common/stage.ts): it shows
  // the meeting of the day, and a moved meeting's day is here.
  @StageAllowed()
  @Get()
  list(@TenantId() tenantId: string, @Query('from') from?: string) {
    if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'from must be YYYY-MM-DD', {
          fields: [{ field: 'from', rules: ['isDateString'] }],
        }),
      );
    }
    return this.service.list(tenantId, from);
  }

  @Put(':week/:kind')
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('week') week: string,
    @Param('kind') kind: string,
    @Body() dto: MoveMeetingDto,
  ) {
    return this.service.move(user, week, kindOf(kind), dto);
  }

  @Delete(':week/:kind')
  moveBack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('week') week: string,
    @Param('kind') kind: string,
  ) {
    return this.service.moveBack(user, week, kindOf(kind));
  }
}

function kindOf(kind: string): MeetingKind {
  if (kind === 'midweek' || kind === 'weekend') return kind;
  throw new BadRequestException(
    refusal('INVALID_FIELD', 'kind must be midweek or weekend', {
      fields: [{ field: 'kind', rules: ['isIn'] }],
    }),
  );
}
