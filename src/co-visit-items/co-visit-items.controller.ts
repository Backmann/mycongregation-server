import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CoVisitItemsService } from './co-visit-items.service';
import { CreateCoVisitItemDto } from './dto/create-co-visit-item.dto';
import { UpdateCoVisitItemDto } from './dto/update-co-visit-item.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Circuit-overseer visit programme items. View: admin or elder. Edit: admin,
 * service overseer, or body coordinator.
 */
@Controller('co-visit-items')
export class CoVisitItemsController {
  constructor(private readonly service: CoVisitItemsService) {}

  /** The signed-in member's own slice of upcoming visits (any role). */
  @Get('mine')
  mine(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mine(congregationId, user);
  }

  /**
   * The field-service meetings of upcoming visits — announced to everyone, so
   * no role guard. Narrow by design: the full item list below stays
   * elder-only because it also carries hosts, addresses and phone numbers.
   */
  @Get('field-service')
  fieldService(@TenantId() congregationId: string) {
    return this.service.fieldService(congregationId);
  }

  /** Hosting rotation across all visits (for the host picker). */
  @Get('host-stats')
  async hostStats(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanViewSchedule(congregationId, user);
    return this.service.hostStats(congregationId);
  }

  /** Elders, the admin, and those who plan the visit (see the service). */
  @Get()
  async list(
    @TenantId() congregationId: string,
    @Query('specialEventId', ParseUUIDPipe) specialEventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanViewSchedule(congregationId, user);
    return this.service.list(congregationId, specialEventId, user);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  create(
    @TenantId() congregationId: string,
    @Body() dto: CreateCoVisitItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(congregationId, dto, user);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoVisitItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(congregationId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(congregationId, id, user.id);
  }

  /** Put a removed item back — the same right as removing it. */
  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  restore(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.restore(congregationId, id);
  }
}
