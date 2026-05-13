import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ServiceReportsService } from './service-reports.service';
import { SubmitReportDto } from './dto/submit-report.dto';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';

@Controller('service-reports')
export class ServiceReportsController {
  constructor(
    private readonly serviceReportsService: ServiceReportsService,
  ) {}

  @Post()
  submit(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitReportDto,
  ) {
    return this.serviceReportsService.submitOwnReport(tenantId, user.id, dto);
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
    return this.serviceReportsService.findMyReports(tenantId, user.id, year);
  }
}
