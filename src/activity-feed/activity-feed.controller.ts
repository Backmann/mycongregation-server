import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ActivityFeedService } from './activity-feed.service';
import { ListActivityFeedDto } from './dto/list-activity-feed.dto';

@Controller('activity-feed')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ELDER)
export class ActivityFeedController {
  constructor(private readonly activityFeedService: ActivityFeedService) {}

  @Get()
  async list(
    @Query() query: ListActivityFeedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.activityFeedService.findFeed(user.congregationId, {
      limit: query.limit,
      before: query.before,
    });
  }
}
