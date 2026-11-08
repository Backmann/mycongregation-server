import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { ClearNotHeldDto } from './dto/clear-not-held.dto';
import { NotHeldService } from './not-held.service';

/**
 * Assignments on meetings that are not held (not-held.service.ts). Every
 * login may ask; the answer holds only what the reader may act on, and the
 * writes check the same rule as the programme itself.
 */
@Controller('not-held')
export class NotHeldController {
  constructor(private readonly service: NotHeldService) {}

  @Get()
  view(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.view(tenantId, user);
  }

  @Post('clear')
  @HttpCode(200)
  clear(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClearNotHeldDto,
  ) {
    return this.service.clear(tenantId, user, dto);
  }

  @Post('restore/:id')
  @HttpCode(200)
  restore(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.restore(tenantId, user, id);
  }
}
