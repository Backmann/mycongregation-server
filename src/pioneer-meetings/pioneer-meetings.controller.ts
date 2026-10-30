import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PioneerMeetingsService } from './pioneer-meetings.service';
import { PioneerMeetingDto } from './pioneer-meeting.dto';

/**
 * The annual meeting of the elders with the pioneers (S-211). Who may read
 * and write is decided in the service: elders read the list, the conductor
 * reads his own meeting, the administrators, the coordinator of the body and
 * the service overseer arrange it.
 */
@Controller('pioneer-meetings')
export class PioneerMeetingsController {
  constructor(private readonly service: PioneerMeetingsService) {}

  @Get()
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(tenantId, user);
  }

  @Get(':id')
  get(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(tenantId, user, id);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PioneerMeetingDto,
  ) {
    return this.service.create(tenantId, user, dto);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PioneerMeetingDto,
  ) {
    return this.service.update(tenantId, user, id, dto);
  }

  @Delete(':id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(tenantId, user, id);
  }
}
