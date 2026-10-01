import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
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

  /**
   * The year as the data stood at the end of a past day — what had been filed
   * by then, as it read then — worked out by today's rules, with everything
   * entered since listed beside it. For telling what a figure already sent to
   * the branch rested on.
   */
  @Get('as-of')
  asOf(
    @TenantId() congregationId: string,
    @Query('startYear') startYear?: string,
    @Query('day') day?: string,
  ) {
    const year = Number(startYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('startYear must be a year, e.g. 2025');
    }
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(Date.parse(day))) {
      throw new BadRequestException('day must be a date, YYYY-MM-DD');
    }
    return this.service.figuresAsOf(congregationId, year, day);
  }
}
