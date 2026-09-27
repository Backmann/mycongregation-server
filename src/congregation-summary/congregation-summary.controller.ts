import { Controller, Get } from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CongregationSummaryService } from './congregation-summary.service';

/**
 * What stands under each door of the «Собрание» contents, for the person
 * asking — one request instead of one per line (27 September). Open to every
 * signed-in member: the service gives each person only what the screens
 * behind the doors already give him.
 */
@Controller('congregation-summary')
export class CongregationSummaryController {
  constructor(private readonly service: CongregationSummaryService) {}

  @Get()
  get(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.forUser(tenantId, user);
  }
}
