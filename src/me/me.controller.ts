import { Controller, Get } from '@nestjs/common';
import { MeService } from './me.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Aggregated "my" views for the signed-in member. Open to any authenticated
 * user; everything is scoped to the publisher linked to their login
 * (publisher.userId) and returns an empty list when no publisher is linked.
 */
@Controller('me')
export class MeController {
  constructor(private readonly service: MeService) {}

  @Get('assignments')
  myAssignments(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.myAssignments(tenantId, user.id);
  }
}
