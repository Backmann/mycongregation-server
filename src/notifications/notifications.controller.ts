import { Controller, Get, UseGuards } from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { NotificationReachService } from './notification-reach.service';

/**
 * Who the congregation's notifications reach. An administrator's view: it
 * names people and says what their devices are doing, which is nobody else's
 * business.
 */
@Controller('notifications')
@UseGuards(RolesGuard)
export class NotificationsController {
  constructor(private readonly reach: NotificationReachService) {}

  @Roles(UserRole.ADMIN)
  @Get('reach')
  report(@TenantId() tenantId: string) {
    return this.reach.report(tenantId);
  }
}
