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
  UseGuards,
} from '@nestjs/common';
import { MeetingSettingsService } from './meeting-settings.service';
import { UpsertMeetingSettingsDto } from './dto/upsert-meeting-settings.dto';
import { UpdateCongregationDto } from './dto/update-congregation.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('meeting-settings')
@UseGuards(RolesGuard)
export class MeetingSettingsController {
  constructor(private readonly service: MeetingSettingsService) {}

  @Get()
  overview(@TenantId() tenantId: string) {
    return this.service.overview(tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Patch('congregation')
  updateCongregation(
    @TenantId() tenantId: string,
    @Body() dto: UpdateCongregationDto,
  ) {
    return this.service.updateCongregation(tenantId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  upsert(@TenantId() tenantId: string, @Body() dto: UpsertMeetingSettingsDto) {
    return this.service.upsert(tenantId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(tenantId, id);
  }
}
