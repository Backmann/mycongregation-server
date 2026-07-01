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
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { CreateFieldServiceMeetingDto } from './dto/create-field-service-meeting.dto';
import { UpdateFieldServiceMeetingDto } from './dto/update-field-service-meeting.dto';
import { QueryFieldServiceMeetingsDto } from './dto/query-field-service-meetings.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Field-ministry meeting schedule. Reading is open to any authenticated
 * member; editing requires the service_overseer responsibility (admins always
 * pass, per the permission matrix).
 */
@Controller('field-service-meetings')
export class FieldServiceMeetingsController {
  constructor(private readonly service: FieldServiceMeetingsService) {}

  @Get()
  list(
    @TenantId() congregationId: string,
    @Query() query: QueryFieldServiceMeetingsDto,
  ) {
    return this.service.list(congregationId, query);
  }

  @Get('conductor-stats')
  conductorStats(@TenantId() congregationId: string) {
    return this.service.conductorStats(congregationId);
  }

  @Get('topic-history')
  topicHistory(@TenantId() congregationId: string) {
    return this.service.topicHistory(congregationId);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  create(
    @TenantId() congregationId: string,
    @Body() dto: CreateFieldServiceMeetingDto,
  ) {
    return this.service.create(congregationId, dto);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFieldServiceMeetingDto,
  ) {
    return this.service.update(congregationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }
}
