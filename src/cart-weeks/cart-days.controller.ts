import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { CartWeeksService } from './cart-weeks.service';
import {
  CancelCartDayDto,
  CartSpanDto,
  CreateCartRequestDto,
} from './dto/cart-span.dto';
import { CreateCartAssignmentDto } from './dto/create-cart-assignment.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

const Arranges = () =>
  RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  );

/**
 * A day at the stand and what happens on it (2 November 2026). Signing up
 * and «не смогу» are a publisher's own; the plan and calling off belong to
 * whoever arranges.
 */
@Controller('cart')
export class CartDaysController {
  constructor(private readonly service: CartWeeksService) {}

  @Patch('days/:id')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  hours(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CartSpanDto,
  ) {
    return this.service.updateDay(congregationId, id, dto);
  }

  @Delete('days/:id')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  async deleteDay(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteDay(congregationId, id);
  }

  @Post('days/:id/requests')
  request(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCartRequestDto,
  ) {
    return this.service.request(congregationId, id, user, dto);
  }

  @Delete('requests/:id')
  @HttpCode(204)
  async withdraw(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.withdrawRequest(congregationId, id, user);
  }

  @Post('days/:id/assignments')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  assign(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCartAssignmentDto,
  ) {
    return this.service.assign(congregationId, id, user, dto);
  }

  @Patch('assignments/:id')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  changeTime(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CartSpanDto,
  ) {
    return this.service.updateAssignment(congregationId, id, dto);
  }

  @Delete('assignments/:id')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  async unassign(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.removeAssignment(congregationId, id);
  }

  /** «Не смогу». */
  @Delete('assignments/:id/mine')
  @HttpCode(204)
  async cancelMine(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.cancelMine(congregationId, id, user);
  }

  @Post('days/:id/cancel')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  cancel(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelCartDayDto,
  ) {
    return this.service.cancelDay(congregationId, id, user, dto);
  }

  @Delete('cancellations/:id')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  async restore(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.restoreDay(congregationId, id);
  }
}
