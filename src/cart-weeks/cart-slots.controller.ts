import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { CartWeeksService } from './cart-weeks.service';
import { CreateCartRequestDto } from './dto/create-cart-request.dto';
import { CreateCartAssignmentDto } from './dto/create-cart-assignment.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

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

  @Delete(':id/my-assignment')
  @HttpCode(204)
  async cancelMine(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.cancelMyAssignment(congregationId, id, user);
  }

  @Post(':id/assignments')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
  )
  assign(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCartAssignmentDto,
  ) {
    return this.service.assignToSlot(congregationId, id, user, dto);
  }

  @Delete(':id/assignments/:assignmentId')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
  )
  async unassign(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    await this.service.removeAssignment(congregationId, id, assignmentId);
  }
}
