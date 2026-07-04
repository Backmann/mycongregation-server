import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CleaningService } from './cleaning.service';
import { SetCleaningSlotDto } from './dto/set-cleaning-slot.dto';
import { ClearCleaningSlotDto } from './dto/clear-cleaning-slot.dto';
import { QueryCleaningDto } from './dto/query-cleaning.dto';
import { PlanThoroughDto } from './dto/plan-thorough.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Kingdom Hall cleaning schedule. Reading is open to any authenticated member;
 * editing requires the cleaning_coordinator responsibility (admins always
 * pass, per the permission matrix).
 */
@Controller('cleaning')
export class CleaningController {
  constructor(private readonly service: CleaningService) {}

  @Get()
  getWeek(
    @TenantId() congregationId: string,
    @Query() query: QueryCleaningDto,
  ) {
    return this.service.getWeek(congregationId, query.weekStart);
  }

  @Put()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.CLEANING_COORDINATOR)
  setSlot(@TenantId() congregationId: string, @Body() dto: SetCleaningSlotDto) {
    return this.service.setSlot(congregationId, dto);
  }

  /**
   * Set/clear the day the group plans to do the weekly thorough cleaning.
   * Permission is checked in the service (coordinator, admin, or the overseer
   * of the assigned group), so no ResponsibilityGuard here.
   */
  @Patch('thorough-plan')
  planThorough(
    @TenantId() congregationId: string,
    @Body() dto: PlanThoroughDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.planThorough(congregationId, dto, user);
  }

  /**
   * Set/clear the date and time of the general (annual) cleaning. Permission
   * is checked in the service (coordinator or admin only).
   */
  @Patch('general-plan')
  planGeneral(
    @TenantId() congregationId: string,
    @Body() dto: PlanThoroughDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.planGeneral(congregationId, dto, user);
  }

  @Delete()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.CLEANING_COORDINATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  clearSlot(
    @TenantId() congregationId: string,
    @Query() query: ClearCleaningSlotDto,
  ) {
    return this.service.clearSlot(
      congregationId,
      query.weekStartDate,
      query.slotType,
    );
  }
}
