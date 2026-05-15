import { Body, Controller, Delete, Post } from '@nestjs/common';
import { PushNotificationsService } from './push-notifications.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import {
  RegisterPushTokenDto,
  UnregisterPushTokenDto,
} from './dto/register-push-token.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('push-tokens')
export class PushNotificationsController {
  constructor(
    private readonly pushService: PushNotificationsService,
  ) {}

  @Post()
  async register(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<{ ok: true }> {
    await this.pushService.registerToken(
      user.id,
      tenantId,
      user.role,
      dto.token,
      dto.deviceInfo,
    );
    return { ok: true };
  }

  @Delete()
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnregisterPushTokenDto,
  ): Promise<{ ok: true }> {
    await this.pushService.unregisterToken(user.id, dto.token);
    return { ok: true };
  }
}
