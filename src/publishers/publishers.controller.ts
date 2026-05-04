import {
  Body,
  Controller,
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

@Controller('publishers')
@UseGuards(RolesGuard)
export class PublishersController {
  constructor(private readonly publishersService: PublishersService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query() query: QueryPublishersDto,
  ) {
    return this.publishersService.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.findOne(tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreatePublisherDto,
  ) {
    return this.publishersService.create(tenantId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublisherDto,
  ) {
    return this.publishersService.update(tenantId, id, dto);
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
}
