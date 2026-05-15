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

  @Get('group')
  findGroup(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('reportMonth') reportMonthRaw?: string,
  ) {
    if (!reportMonthRaw) {
      throw new BadRequestException(
        'reportMonth query parameter is required (YYYY-MM)',
      );
    }
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(reportMonthRaw)) {
      throw new BadRequestException(
        'reportMonth must be in YYYY-MM or YYYY-MM-DD format',
      );
    }
    return this.serviceReportsService.findGroupReports(
      tenantId,
      user,
      reportMonthRaw,
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
