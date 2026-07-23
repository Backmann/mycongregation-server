import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnnualReportService } from './annual-report.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Figures for the annual congregation report (S-10).
 *
 * The secretary's own document, and it names people — who is inactive, who is
 * in prison — so it is not open to the congregation the way attendance is.
 */
@Controller('annual-report')
@UseGuards(ResponsibilityGuard)
@RequireResponsibility(ResponsibilityType.SECRETARY)
export class AnnualReportController {
  constructor(private readonly service: AnnualReportService) {}

  @Get()
  figures(
    @TenantId() congregationId: string,
    @Query('startYear') startYear?: string,
  ) {
    const now = new Date();
    // Filed in early September for the year that has just ended, so before
    // September the year in question is still the one that began last autumn.
    const fallback =
      now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return this.service.figures(
      congregationId,
      startYear ? Number(startYear) : fallback,
    );
  }
}
