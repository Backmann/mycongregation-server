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
import { MarkUsedLocalNeedsTopicDto } from './dto/mark-used-local-needs-topic.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';

/**
 * Local-needs topic backlog. Reading is for elders, writing for an
 * administrator or the Life & Ministry overseer — both enforced in the
 * service. (This comment used to name four managing responsibilities and open
 * reading to every member; neither has been true of the code.)
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

  /** Mark used — this congregation's current week unless a week is named. */
  @Post(':id/used')
  markUsed(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkUsedLocalNeedsTopicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markUsed(tenantId, id, dto, user);
  }

  /** Back to the plan. */
  @Delete(':id/used')
  markPlanned(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markPlanned(tenantId, id, user);
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
