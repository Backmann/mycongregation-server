import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { PlaceLocalNeedsTopicDto } from '../dto/place-local-needs-topic.dto';
import { LocalNeedsPlacementService } from './local-needs-placement.service';

@Controller('local-needs')
export class LocalNeedsPlacementController {
  constructor(private readonly service: LocalNeedsPlacementService) {}

  /** Put the topic into a week: on a part, or as one more part. */
  @Post(':id/place')
  place(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlaceLocalNeedsTopicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.place(tenantId, id, dto, user);
  }
}
