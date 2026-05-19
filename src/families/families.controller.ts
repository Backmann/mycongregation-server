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
import { FamiliesService } from './families.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { QueryFamiliesDto } from './dto/query-families.dto';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('families')
@UseGuards(RolesGuard)
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: QueryFamiliesDto) {
    return this.familiesService.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.familiesService.findOne(tenantId, id);
  }

  @Get(':id/publishers')
  findPublishers(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryPublishersDto,
  ) {
    return this.familiesService.findPublishers(tenantId, id, query);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateFamilyDto) {
    return this.familiesService.create(tenantId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFamilyDto,
  ) {
    return this.familiesService.update(tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.familiesService.remove(tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.familiesService.restore(tenantId, id);
  }
}
