import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { CartWeeksService } from './cart-weeks.service';
import { CreateCartRequestDto } from './dto/create-cart-request.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Self-service request endpoints for eligible publishers (capability
 * public_witnessing). Eligibility + "collecting" status enforced in service.
 */
@Controller('cart-slots')
export class CartSlotsController {
  constructor(private readonly service: CartWeeksService) {}

  @Post(':id/request')
  apply(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCartRequestDto,
  ) {
    return this.service.applyToSlot(congregationId, id, user, dto);
  }

  @Delete(':id/request')
  @HttpCode(204)
  async withdraw(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.withdrawFromSlot(congregationId, id, user);
  }
}
