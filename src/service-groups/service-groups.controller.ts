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
import { QueryServiceGroupsDto } from './dto/query-service-groups.dto';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
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
  ) {
    return this.serviceGroupsService.findPublishers(tenantId, id, query);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateServiceGroupDto) {
    return this.serviceGroupsService.create(tenantId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceGroupDto,
  ) {
    return this.serviceGroupsService.update(tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.serviceGroupsService.remove(tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.serviceGroupsService.restore(tenantId, id);
  }
}
