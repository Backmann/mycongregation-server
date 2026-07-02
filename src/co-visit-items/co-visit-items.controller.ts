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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Circuit-overseer visit programme items. View: admin or elder. Edit: admin,
 * service overseer, or body coordinator.
 */
@Controller('co-visit-items')
export class CoVisitItemsController {
  constructor(private readonly service: CoVisitItemsService) {}

  /** The signed-in member's own slice of upcoming visits (any role). */
  @Get('mine')
  mine(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mine(congregationId, user);
  }

  /** Hosting rotation across all visits (for the host picker). */
  @Get('host-stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  hostStats(@TenantId() congregationId: string) {
    return this.service.hostStats(congregationId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  list(
    @TenantId() congregationId: string,
    @Query('specialEventId', ParseUUIDPipe) specialEventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(congregationId, specialEventId, user);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  create(
    @TenantId() congregationId: string,
    @Body() dto: CreateCoVisitItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(congregationId, dto, user);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoVisitItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(congregationId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }
}
