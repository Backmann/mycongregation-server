import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ServiceLogService } from './service-log.service';
import { ServiceLogEntryDto } from './dto/service-log.dto';

/**
 * A pioneer's own hours log (Lionel, 29 October 2026). Every route answers
 * about the one asking and nobody else — there is no publisher id to give.
 */
@Controller('service-log')
@UseGuards(JwtAuthGuard)
export class ServiceLogController {
  constructor(private readonly service: ServiceLogService) {}

  /** The open months the log is his — for Home and the door. */
  @Get()
  overview(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.overview(tenantId, user);
  }

  /** ?month=YYYY-MM — one month: entries, sums, goal, the report's state. */
  @Get('month')
  month(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('month') month?: string,
  ) {
    return this.service.month(tenantId, user, month);
  }

  /** Written or written again; the id comes from the phone. */
  @Put('entries/:id')
  put(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ServiceLogEntryDto,
  ) {
    return this.service.put(tenantId, user, id, dto);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.remove(tenantId, user, id);
  }
}
