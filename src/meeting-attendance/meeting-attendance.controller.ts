import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MeetingAttendanceService } from './meeting-attendance.service';
import {
  MoveAttendanceDto,
  RecordAttendanceDto,
  RemoveAttendanceDto,
} from './dto/record-attendance.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { AttendanceReadGuard } from './attendance-read.guard';
import { CongregationClock } from '../common/congregation-clock.service';

/**
 * Meeting attendance — form S-3.
 *
 * Writing (31 October 2026, Lionel): the secretary, the administrators, the
 * brother who counts and the one who stands in for him, and the duties
 * coordinator. Reading: the same, and the elders — they look, they do not
 * change (AttendanceReadGuard). A publisher has no task that needs the sheet.
 */
@Controller('meeting-attendance')
export class MeetingAttendanceController {
  constructor(
    private readonly service: MeetingAttendanceService,
    private readonly clock: CongregationClock,
  ) {}

  /** The S-3 sheet for a service year (September–August). */
  @Get('service-year')
  @UseGuards(AttendanceReadGuard)
  async serviceYear(
    @TenantId() congregationId: string,
    @Query('startYear') startYear?: string,
  ) {
    // Before September the current service year began in the previous
    // calendar year — by the congregation's own day, not the server's.
    const today = await this.clock.todayFor(congregationId);
    const y = Number(today.slice(0, 4));
    const fallback = Number(today.slice(5, 7)) >= 9 ? y : y - 1;
    const year = startYear ? Number(startYear) : fallback;
    return this.service.serviceYear(congregationId, year);
  }

  /** Meetings already held with no figure yet — what the home card offers. */
  @Get('pending')
  @UseGuards(AttendanceReadGuard)
  pending(@TenantId() congregationId: string) {
    return this.service.pending(congregationId);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SECRETARY,
    ResponsibilityType.ATTENDANCE_RECORDER,
    ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
    ResponsibilityType.DUTIES_COORDINATOR,
  )
  record(
    @TenantId() congregationId: string,
    @Body() dto: RecordAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.record(congregationId, dto, user.id);
  }

  /** Take away a figure entered on the wrong day. */
  @Delete()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SECRETARY,
    ResponsibilityType.ATTENDANCE_RECORDER,
    ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
    ResponsibilityType.DUTIES_COORDINATOR,
  )
  remove(
    @TenantId() congregationId: string,
    @Query() dto: RemoveAttendanceDto,
  ) {
    return this.service.remove(congregationId, dto);
  }

  /** Move a figure to the meeting it belongs to. */
  @Post('move')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SECRETARY,
    ResponsibilityType.ATTENDANCE_RECORDER,
    ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
    ResponsibilityType.DUTIES_COORDINATOR,
  )
  move(@TenantId() congregationId: string, @Body() dto: MoveAttendanceDto) {
    return this.service.move(congregationId, dto);
  }
}
