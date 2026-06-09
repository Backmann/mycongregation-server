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
import { SpecialEventsService } from './special-events.service';
import { CreateSpecialEventDto } from './dto/create-special-event.dto';
import { UpdateSpecialEventDto } from './dto/update-special-event.dto';
import { QuerySpecialEventsDto } from './dto/query-special-events.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Congregation special events (assemblies, conventions, the Memorial, circuit
 * overseer / branch representative visits, etc.). Reading is open to any
 * authenticated member; creating and editing requires the body_coordinator
 * responsibility (admins always pass).
 */
@Controller('special-events')
export class SpecialEventsController {
  constructor(private readonly service: SpecialEventsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: QuerySpecialEventsDto) {
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
  @RequireResponsibility(ResponsibilityType.BODY_COORDINATOR)
  create(@TenantId() tenantId: string, @Body() dto: CreateSpecialEventDto) {
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.BODY_COORDINATOR)
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpecialEventDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.BODY_COORDINATOR)
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(tenantId, id);
  }

  @Post(':id/restore')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.BODY_COORDINATOR)
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.restore(tenantId, id);
  }
}
