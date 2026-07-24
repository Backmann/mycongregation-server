import {
  BadRequestException,
  Body,
  Controller,
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

@Controller('service-reports')
export class ServiceReportsController {
  constructor(
    private readonly serviceReportsService: ServiceReportsService,
    private readonly auditLogService: AuditLogService,
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
  closeMonth(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body('reportMonth') reportMonth?: string,
  ) {
    return this.serviceReportsService.closeMonth(
      tenantId,
      user,
      requireMonth(reportMonth),
    );
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
  getSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('reportMonth') reportMonthRaw?: string,
  ) {
    return this.serviceReportsService.getSummary(
      tenantId,
      user,
      requireMonth(reportMonthRaw),
    );
  }

  @Get('year-summary')
  getYearSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') yearRaw?: string,
  ) {
    // Default to the current service year: Sep..Dec belong to next year's label.
    const now = new Date();
    const defaultYear =
      now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    const year = yearRaw ? parseInt(yearRaw, 10) || defaultYear : defaultYear;
    return this.serviceReportsService.getYearSummary(tenantId, user, year);
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
    const months = monthsRaw
      ? Math.max(1, Math.min(120, parseInt(monthsRaw, 10) || 12))
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
