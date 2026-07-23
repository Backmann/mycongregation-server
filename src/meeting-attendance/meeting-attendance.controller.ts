import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { RecordAttendanceDto } from './dto/record-attendance.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Meeting attendance — form S-3.
 *
 * Reading is open to any signed-in member: the figures are about the meeting,
 * not about anybody in particular, and the congregation hears them read out
 * anyway. Writing belongs to the secretary, to whoever holds the attendance
 * responsibility, and to admins, who always pass.
 */
@Controller('meeting-attendance')
export class MeetingAttendanceController {
  constructor(private readonly service: MeetingAttendanceService) {}

  @Get()
  range(
    @TenantId() congregationId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.range(congregationId, from, to);
  }

  /** The S-3 sheet for a service year (September–August). */
  @Get('service-year')
  serviceYear(
    @TenantId() congregationId: string,
    @Query('startYear') startYear?: string,
  ) {
    const now = new Date();
    // Before September the current service year began in the previous
    // calendar year — a sheet opened in July belongs to the year that started
    // last September, not to one that has not begun.
    const fallback =
      now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const year = startYear ? Number(startYear) : fallback;
    return this.service.serviceYear(congregationId, year);
  }

  /** Meetings already held with no figure yet — what the home card offers. */
  @Get('pending')
  pending(@TenantId() congregationId: string) {
    return this.service.pending(congregationId);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SECRETARY,
    ResponsibilityType.ATTENDANCE_RECORDER,
  )
  record(
    @TenantId() congregationId: string,
    @Body() dto: RecordAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.record(congregationId, dto, user.id);
  }
}
