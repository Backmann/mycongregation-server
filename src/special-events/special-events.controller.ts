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
import { UpdateAccommodationDto } from './dto/update-accommodation.dto';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Congregation special events (assemblies, conventions, the Memorial, circuit
 * overseer / branch representative visits, etc.). Reading is open to any
 * authenticated member (where the circuit overseer stays only for those who
 * arrange the visit, the bin only for keepers); creating and editing requires
 * the body_coordinator responsibility (admins always pass).
 */
@Controller('special-events')
export class SpecialEventsController {
  constructor(private readonly service: SpecialEventsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query() query: QuerySpecialEventsDto,
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
    return this.service.findOneFor(tenantId, id, user);
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

  /**
   * Where the circuit overseer stays. Open also to the service overseer and
   * his assistant: they arrange the visit schedule, where this is set.
   */
  @Patch(':id/accommodation')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  updateAccommodation(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccommodationDto,
  ) {
    return this.service.updateAccommodation(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.BODY_COORDINATOR)
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(tenantId, id, user);
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
