import { Body, Controller, Delete, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { WebPushService } from './web-push.service';
import {
  RegisterWebPushSubscriptionDto,
  UnregisterWebPushSubscriptionDto,
} from './dto/register-web-push-subscription.dto';

@Controller('web-push-subscriptions')
export class WebPushController {
  constructor(private readonly webPushService: WebPushService) {}

  @Post()
  async register(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterWebPushSubscriptionDto,
  ): Promise<{ ok: true }> {
    await this.webPushService.registerSubscription(
      user.id,
      tenantId,
      user.role,
      dto,
    );
    return { ok: true };
  }

  @Delete()
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnregisterWebPushSubscriptionDto,
  ): Promise<{ ok: true }> {
    await this.webPushService.removeSubscription(user.id, dto.endpoint);
    return { ok: true };
  }
}
