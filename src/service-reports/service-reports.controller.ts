import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ServiceReportsService } from './service-reports.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MonthlySentService } from './monthly-sent.service';
import { UserRole } from '../common/enums/user-role.enum';
import { SubmitReportDto } from './dto/submit-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';

const MONTH_RE = /^\d{4}-\d{2}(-\d{2})?$/;

function requireMonth(value: string | undefined): string {
  if (!value) {
    throw new BadRequestException('reportMonth is required (YYYY-MM)');
  }
  if (!MONTH_RE.test(value)) {
    throw new BadRequestException(
      'reportMonth must be in YYYY-MM or YYYY-MM-DD format',
    );
  }
  return value;
}

/**
 * How far back a publisher's history is ever shown or filled in.
 *
 * Double what any rule needs — the status weighs six closed months, the annual
 * report twelve. A cap on the VIEW only; the reports are kept for good.
 */
const HISTORY_MAX_MONTHS = 24;

@Controller('service-reports')
export class ServiceReportsController {
  constructor(
    private readonly serviceReportsService: ServiceReportsService,
    private readonly auditLogService: AuditLogService,
    private readonly monthlySent: MonthlySentService,
  ) {}

  @Post()
  submit(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitReportDto,
  ) {
    return this.serviceReportsService.submitOwnReport(tenantId, user, dto);
  }

  @Post('close')
  async closeMonth(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body('reportMonth') reportMonth?: string,
  ) {
    const month = requireMonth(reportMonth);
    const before = await this.serviceReportsService.getClosureStatus(
      tenantId,
      user,
      month,
    );
    const after = await this.serviceReportsService.closeMonth(
      tenantId,
      user,
      month,
    );
    // Closing is «done, sent»: keep the figures as they stand. Only when it
    // actually closed now — a second tap must not move the day it was sent.
    if (!before.closed && after.closed) {
      await this.monthlySent.saveSent(tenantId, user.id, month);
    }
    return after;
  }

  @Post('reopen')
  reopenMonth(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body('reportMonth') reportMonth?: string,
  ) {
    return this.serviceReportsService.reopenMonth(
      tenantId,
      user,
      requireMonth(reportMonth),
    );
  }

  @Get('my')
  findMy(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') yearRaw?: string,
  ) {
    let year: number | undefined;
    if (yearRaw !== undefined && yearRaw !== '') {
      year = parseInt(yearRaw, 10);
      if (isNaN(year) || year < 2000 || year > 2100) {
        throw new BadRequestException('year must be between 2000 and 2100');
      }
    }
    return this.serviceReportsService.findMyReports(tenantId, user, year);
  }

  @Get('my-standing')
  myStanding(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serviceReportsService.myReportStanding(tenantId, user);
  }

  @Get('group')
  findGroup(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('reportMonth') reportMonthRaw?: string,
  ) {
    return this.serviceReportsService.findGroupReports(
      tenantId,
      user,
      requireMonth(reportMonthRaw),
    );
  }

  @Get('summary')
  async getSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('reportMonth') reportMonthRaw?: string,
  ) {
    const live = await this.serviceReportsService.getSummary(
      tenantId,
      user,
      requireMonth(reportMonthRaw),
    );
    return this.monthlySent.withSent(tenantId, live);
  }

  /**
   * The pioneers' standing in a service year. Defaults to the current one,
   * counted the way the year runs: September belongs to the NEXT year's label.
   */
  @Get('pioneer-year-review')
  getPioneerYearReview(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') yearRaw?: string,
    @Query('window') windowRaw?: string,
  ) {
    // The defaults are the congregation's own date, not the server's UTC —
    // decided in the service, where its clock is.
    const year = yearRaw ? parseInt(yearRaw, 10) || undefined : undefined;
    const window =
      windowRaw === 'half' || windowRaw === 'year' ? windowRaw : undefined;
    return this.serviceReportsService.getPioneerYearReview(
      tenantId,
      user,
      year,
      window,
    );
  }

  @Get('collection')
  getCollection(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serviceReportsService.getReportCollection(tenantId, user);
  }

  @Get('closure')
  getClosure(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('reportMonth') reportMonthRaw?: string,
  ) {
    return this.serviceReportsService.getClosureStatus(
      tenantId,
      user,
      requireMonth(reportMonthRaw),
    );
  }

  @Get(':id/audit-log')
  async getAuditLog(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) reportId: string,
  ) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.ELDER) {
      throw new ForbiddenException(
        'Only elders and admins may view audit logs.',
      );
    }
    // Verify the report exists in this tenant (findOne enforces access).
    const report = await this.serviceReportsService.findOne(
      tenantId,
      user,
      reportId,
    );
    return this.auditLogService.findForEntity(
      tenantId,
      'ServiceReport',
      report.id,
    );
  }

  @Get('s21/:publisherId')
  getS21Data(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('publisherId', ParseUUIDPipe) publisherId: string,
    @Query('year') yearRaw?: string,
  ) {
    const now = new Date();
    const defaultYear =
      now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    const year = yearRaw ? parseInt(yearRaw, 10) || defaultYear : defaultYear;
    return this.serviceReportsService.getS21Data(
      tenantId,
      user,
      publisherId,
      year,
    );
  }

  @Get('by-publisher/:publisherId')
  async findHistoryForPublisher(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('publisherId', ParseUUIDPipe) publisherId: string,
    @Query('months') monthsRaw?: string,
  ) {
    // Two years, and no more.
    //
    // Nothing in the app looks further back: a service status weighs six
    // closed months, the annual report twelve. The screen asked for a hundred
    // and twenty — ten years — and for a publisher with no reports and no
    // dates on his card that came back as a hundred and twenty empty rows to
    // scroll past. Twenty-four is double what any rule needs, which is enough
    // slack and still a page a person can read.
    //
    // This caps what is SHOWN, never what is kept: the reports themselves stay
    // for good. A congregation's S-21 cards are not thrown away after two
    // years, and once the paper is gone there would be nowhere to restore
    // from.
    const months = monthsRaw
      ? Math.max(1, Math.min(HISTORY_MAX_MONTHS, parseInt(monthsRaw, 10) || 12))
      : 12;
    return this.serviceReportsService.findHistoryForPublisher(
      tenantId,
      user,
      publisherId,
      months,
    );
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceReportsService.findOne(tenantId, user, id);
  }

  /**
   * Take a report back. Soft: the row keeps its place and can be restored, and
   * the journal records who took it and when.
   */
  @Delete(':id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceReportsService.removeReport(tenantId, user, id);
  }

  /** Put back a report taken away by mistake. */
  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceReportsService.restoreReport(tenantId, user, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.serviceReportsService.updateReport(tenantId, user, id, dto);
  }
}
