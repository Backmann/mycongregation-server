import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { FieldServiceMonthThemesService } from './field-service-month-themes.service';
import { UpsertFieldServiceMonthThemeDto } from './dto/upsert-field-service-month-theme.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Monthly theme for field-service meetings. Reading is open to any member;
 * editing requires the service_overseer responsibility (admins always pass).
 */
@Controller('field-service-month-themes')
export class FieldServiceMonthThemesController {
  constructor(private readonly service: FieldServiceMonthThemesService) {}

  @Get()
  list(@TenantId() congregationId: string) {
    return this.service.list(congregationId);
  }

  @Put()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SERVICE_OVERSEER)
  upsert(
    @TenantId() congregationId: string,
    @Body() dto: UpsertFieldServiceMonthThemeDto,
  ) {
    return this.service.upsert(congregationId, dto);
  }
}
