import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { FieldServiceTemplateService } from './field-service-template.service';
import {
  GenerateFieldServiceDto,
  ReplaceFieldServiceTemplateDto,
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
  constructor(private readonly service: FieldServiceTemplateService) {}

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
