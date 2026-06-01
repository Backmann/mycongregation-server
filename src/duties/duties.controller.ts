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
import { DutiesService } from './duties.service';
import { QueryDutiesDto } from './dto/query-duties.dto';
import { GenerateWeekDutiesDto } from './dto/generate-week-duties.dto';
import { AssignDutyDto } from './dto/assign-duty.dto';
import { CreateCustomDutyDto } from './dto/create-custom-duty.dto';
import { SetMicrophoneSlotsDto } from './dto/set-microphone-slots.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Meeting duties. Reading is open to any authenticated member; editing requires
 * the duties_coordinator OR body_coordinator responsibility (the body
 * coordinator / совет старейшин edits duties too; admins always pass).
 */
@Controller('duties')
export class DutiesController {
  constructor(private readonly service: DutiesService) {}

  @Get()
  list(@TenantId() congregationId: string, @Query() query: QueryDutiesDto) {
    return this.service.list(congregationId, query);
  }

  @Post('generate')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  generate(
    @TenantId() congregationId: string,
    @Body() dto: GenerateWeekDutiesDto,
  ) {
    return this.service.generateWeek(congregationId, dto);
  }

  @Post('custom')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  createCustom(
    @TenantId() congregationId: string,
    @Body() dto: CreateCustomDutyDto,
  ) {
    return this.service.createCustom(congregationId, dto);
  }

  @Patch('microphone-slots')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  setMicrophoneSlots(
    @TenantId() congregationId: string,
    @Body() dto: SetMicrophoneSlotsDto,
  ) {
    return this.service.setMicrophoneSlots(congregationId, dto.microphoneSlots);
  }

  @Patch(':id/assign')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  assign(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDutyDto,
  ) {
    return this.service.assign(congregationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }
}
