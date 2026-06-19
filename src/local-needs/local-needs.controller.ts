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
} from '@nestjs/common';
import { LocalNeedsService } from './local-needs.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateLocalNeedsTopicDto } from './dto/create-local-needs-topic.dto';
import { UpdateLocalNeedsTopicDto } from './dto/update-local-needs-topic.dto';
import { QueryLocalNeedsTopicsDto } from './dto/query-local-needs-topics.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';

/**
 * Local-needs topic backlog. Reading is open to any authenticated member so
 * the schedule editor can offer planned topics; writing is limited to
 * scheduling managers (admin / body_coordinator / life_ministry_overseer /
 * secretary) — enforced in the service.
 */
@Controller('local-needs')
export class LocalNeedsController {
  constructor(private readonly service: LocalNeedsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query() query: QueryLocalNeedsTopicsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(tenantId, query, user);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(tenantId, id, user);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateLocalNeedsTopicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(tenantId, dto, user);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocalNeedsTopicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(tenantId, id, user);
  }

  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.restore(tenantId, id, user);
  }
}
