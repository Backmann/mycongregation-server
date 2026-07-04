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
import { AbsencesService } from './absences.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateAbsenceDto } from './dto/create-absence.dto';
import { UpdateAbsenceDto } from './dto/update-absence.dto';
import { QueryAbsencesDto } from './dto/query-absences.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';

/**
 * Advisory publisher absences. Reading is open to any authenticated member so
 * absence warnings can surface in every assignment editor. Writing is
 * authorized in the service: managers (admin / body_coordinator /
 * life_ministry_overseer / secretary) may write any absence; anyone else
 * may write only their own.
 */
@Controller('absences')
export class AbsencesController {
  constructor(private readonly service: AbsencesService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query() query: QueryAbsencesDto,
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
    @Body() dto: CreateAbsenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(tenantId, dto, user);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAbsenceDto,
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
