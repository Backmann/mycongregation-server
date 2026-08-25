import { Controller, Get, Query } from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { ServiceOverseerService } from './service-overseer.service';
import { CongregationClock } from '../common/congregation-clock.service';

/**
 * Which groups the service overseer has visited, and which still wait.
 *
 * Reading is open to any signed-in member, like the meeting schedule itself:
 * Lionel asked that a group should know in advance that he is coming, and the
 * facts here — a date and a name — are read out at the meeting anyway.
 */
@Controller('service-overseer')
export class ServiceOverseerController {
  constructor(
    private readonly service: ServiceOverseerService,
    private readonly clock: CongregationClock,
  ) {}

  @Get('group-visits')
  async groupVisits(
    @TenantId() congregationId: string,
    @Query('serviceYear') serviceYear?: string,
  ) {
    // The service year turns over on 1 September. By the server's UTC clock
    // that turn happens two hours late in a German summer, so a visit looked
    // up just after midnight would be filed under the year that just ended.
    const today = await this.clock.todayFor(congregationId);
    const year = Number(serviceYear) || currentServiceYear(today);
    return this.service.groupVisits(congregationId, year, today);
  }
}

/**
 * The service year is named for the August it ends in: September 2025 through
 * August 2026 is service year 2026. The same reckoning the reports use.
 */
export function currentServiceYear(today: string): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month >= 9 ? year + 1 : year;
}
