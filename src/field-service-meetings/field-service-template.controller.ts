import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { FieldServiceTemplateService } from './field-service-template.service';
import { FieldServicePlannerService } from './field-service-planner.service';
import {
  GenerateFieldServiceDto,
  PrepareFieldServiceMonthDto,
  ReplaceFieldServiceTemplateDto,
  UpdateFieldServiceSettingsDto,
} from './dto/field-service-template.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Recurring field-service meeting template + generator. Reading the template is
 * open; replacing it and generating meetings require the service_overseer
 * responsibility (admins always pass).
 */
@Controller('field-service-template')
export class FieldServiceTemplateController {
  constructor(
    private readonly service: FieldServiceTemplateService,
    private readonly planner: FieldServicePlannerService,
  ) {}

  /** The calendar switches and, for later, the automatic preparation. */
  @Get('settings')
  settings(@TenantId() congregationId: string) {
    return this.service.getSettings(congregationId);
  }

  @Patch('settings')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  updateSettings(
    @TenantId() congregationId: string,
    @Body() dto: UpdateFieldServiceSettingsDto,
  ) {
    return this.service.updateSettings(congregationId, dto);
  }

  /** The month as it will be: nothing written. */
  @Post('preview')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  preview(
    @TenantId() congregationId: string,
    @Body() dto: PrepareFieldServiceMonthDto,
  ) {
    return this.planner.preview(
      congregationId,
      dto.year,
      dto.month,
      dto.pickConductors !== false,
    );
  }

  /** The month written, as drafts. Publishing it is a separate step. */
  @Post('prepare')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  prepare(
    @TenantId() congregationId: string,
    @Body() dto: PrepareFieldServiceMonthDto,
  ) {
    return this.planner.prepare(
      congregationId,
      dto.year,
      dto.month,
      dto.pickConductors !== false,
    );
  }

  @Get()
  getSlots(@TenantId() congregationId: string) {
    return this.service.getSlots(congregationId);
  }

  @Put()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  replaceSlots(
    @TenantId() congregationId: string,
    @Body() dto: ReplaceFieldServiceTemplateDto,
  ) {
    return this.service.replaceSlots(congregationId, dto);
  }

  @Post('generate')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  generate(
    @TenantId() congregationId: string,
    @Body() dto: GenerateFieldServiceDto,
  ) {
    return this.service.generate(congregationId, dto);
  }
}
