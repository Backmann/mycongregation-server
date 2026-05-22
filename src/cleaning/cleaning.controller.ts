import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CleaningService } from './cleaning.service';
import { SetCleaningSlotDto } from './dto/set-cleaning-slot.dto';
import { ClearCleaningSlotDto } from './dto/clear-cleaning-slot.dto';
import { QueryCleaningDto } from './dto/query-cleaning.dto';
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
