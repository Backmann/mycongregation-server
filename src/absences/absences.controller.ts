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
import { AbsencesService } from './absences.service';
import { CreateAbsenceDto } from './dto/create-absence.dto';
import { UpdateAbsenceDto } from './dto/update-absence.dto';
import { QueryAbsencesDto } from './dto/query-absences.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Advisory publisher absences. Reading is open to any authenticated member so
 * absence warnings can surface in every assignment editor; creating and
 * editing requires the body_coordinator, life_ministry_overseer or secretary
 * responsibility (admins always pass).
 */
@Controller('absences')
export class AbsencesController {
  constructor(private readonly service: AbsencesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: QueryAbsencesDto) {
    return this.service.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.SECRETARY,
  )
  create(@TenantId() tenantId: string, @Body() dto: CreateAbsenceDto) {
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.SECRETARY,
  )
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAbsenceDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.SECRETARY,
  )
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(tenantId, id);
  }

  @Post(':id/restore')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.SECRETARY,
  )
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.restore(tenantId, id);
  }
}
