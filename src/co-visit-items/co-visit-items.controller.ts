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
import { CoVisitItemsService } from './co-visit-items.service';
import { CreateCoVisitItemDto } from './dto/create-co-visit-item.dto';
import { UpdateCoVisitItemDto } from './dto/update-co-visit-item.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Circuit-overseer visit programme items. View: admin or elder. Edit: admin,
 * service overseer, or body coordinator.
 */
@Controller('co-visit-items')
export class CoVisitItemsController {
  constructor(private readonly service: CoVisitItemsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  list(
    @TenantId() congregationId: string,
    @Query('specialEventId', ParseUUIDPipe) specialEventId: string,
  ) {
    return this.service.list(congregationId, specialEventId);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.BODY_COORDINATOR,
  )
  create(
    @TenantId() congregationId: string,
    @Body() dto: CreateCoVisitItemDto,
  ) {
    return this.service.create(congregationId, dto);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.BODY_COORDINATOR,
  )
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoVisitItemDto,
  ) {
    return this.service.update(congregationId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.BODY_COORDINATOR,
  )
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }
}
