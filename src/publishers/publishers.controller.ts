import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PublishersService } from './publishers.service';
import { CreatePublisherDto } from './dto/create-publisher.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';
import { QueryPublishersDto } from './dto/query-publishers.dto';
import { RemovePublisherDto } from './dto/remove-publisher.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { OverrideStatusDto } from './dto/override-status.dto';
import { GrantAccessDto } from './dto/grant-access.dto';
import { UpdateAccessDto } from './dto/update-access.dto';

@Controller('publishers')
@UseGuards(RolesGuard)
export class PublishersController {
  constructor(private readonly publishersService: PublishersService) {}

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Patch(':id/status')
  overrideStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideStatusDto,
  ) {
    return this.publishersService.overrideStatus(tenantId, user, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Delete(':id/status-override')
  clearOverride(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.clearOverride(tenantId, user, id);
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: QueryPublishersDto) {
    return this.publishersService.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.findOne(tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/access')
  getAccess(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.getAccess(tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/access')
  grantAccess(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantAccessDto,
  ) {
    return this.publishersService.grantAccess(tenantId, id, dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/access')
  updateAccess(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessDto,
  ) {
    return this.publishersService.updateAccess(tenantId, id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreatePublisherDto) {
    return this.publishersService.create(tenantId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublisherDto,
  ) {
    return this.publishersService.update(tenantId, id, dto, user?.id);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Post(':id/remove')
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemovePublisherDto,
  ) {
    return this.publishersService.remove(tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.restore(tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  purge(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.publishersService.purge(tenantId, id);
  }
}
