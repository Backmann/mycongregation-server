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

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
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
  )
  async remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteWeek(congregationId, id);
  }
}
