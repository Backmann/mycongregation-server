import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { CartWeeksService } from './cart-weeks.service';
import { BuildCartWeekDto } from './dto/build-cart-week.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CopyCartWeekDto } from './dto/copy-cart-week.dto';
import { CartSlotsChangeDto } from './dto/cart-slots-change.dto';

@Controller('cart-weeks')
export class CartWeeksController {
  constructor(private readonly service: CartWeeksService) {}

  @Get()
  getWeek(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('weekStart') weekStart: string,
  ) {
    return this.service.getWeek(congregationId, weekStart, user);
  }

  @Get('pairings')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  pairings(@TenantId() congregationId: string, @Query('weeks') weeks?: string) {
    // A number of weeks, 1 to 52; anything else is the usual eight — a bad
    // query string used to reach the database as NaN and come back a 500.
    const n = Number(weeks);
    return this.service.recentPairings(
      congregationId,
      Number.isInteger(n) && n >= 1 && n <= 52 ? n : 8,
    );
  }

  @Post('copy')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  copy(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CopyCartWeekDto,
  ) {
    return this.service.copyWeek(
      congregationId,
      user.id,
      dto.weekStartDate,
      dto.fromWeekStartDate,
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  cancelSlots(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CartSlotsChangeDto,
  ) {
    return this.service.cancelSlots(
      congregationId,
      id,
      user,
      dto.slotIds,
      dto.reason,
    );
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  restoreSlots(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CartSlotsChangeDto,
  ) {
    return this.service.restoreSlots(congregationId, id, user, dto.slotIds);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  build(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BuildCartWeekDto,
  ) {
    return this.service.buildWeek(congregationId, user.id, dto);
  }

  @Post(':id/open')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  open(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.openWeek(congregationId, id);
  }

  @Post(':id/publish')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  publish(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.publishWeek(congregationId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  async remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteWeek(congregationId, id);
  }
}
