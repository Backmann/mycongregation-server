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
import { ServiceGroupsService } from './service-groups.service';
import { CreateServiceGroupDto } from './dto/create-service-group.dto';
import { UpdateServiceGroupDto } from './dto/update-service-group.dto';
import { AddGroupMembersDto } from './dto/add-group-members.dto';
import { QueryServiceGroupsDto } from './dto/query-service-groups.dto';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('service-groups')
@UseGuards(RolesGuard)
export class ServiceGroupsController {
  constructor(private readonly serviceGroupsService: ServiceGroupsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: QueryServiceGroupsDto) {
    return this.serviceGroupsService.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceGroupsService.findOne(tenantId, id);
  }

  @Get(':id/publishers')
  findPublishers(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryPublishersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serviceGroupsService.findPublishers(tenantId, id, query, user);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/publishers')
  addPublishers(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddGroupMembersDto,
  ) {
    return this.serviceGroupsService.addPublishers(
      tenantId,
      id,
      dto.publisherIds,
    );
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/publishers/:publisherId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePublisher(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('publisherId', ParseUUIDPipe) publisherId: string,
  ) {
    return this.serviceGroupsService.removePublisher(tenantId, id, publisherId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateServiceGroupDto) {
    return this.serviceGroupsService.create(tenantId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceGroupDto,
  ) {
    return this.serviceGroupsService.update(tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.serviceGroupsService.remove(tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceGroupsService.restore(tenantId, id);
  }
}
