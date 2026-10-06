import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  publicResponsibility,
  ResponsibilitiesService,
} from './responsibilities.service';
import type {
  PublicResponsibility,
  ResponsibilityView,
} from './responsibilities.service';
import { AssignResponsibilityDto } from './dto/assign-responsibility.dto';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('responsibilities')
@UseGuards(RolesGuard)
export class ResponsibilitiesController {
  constructor(
    private readonly responsibilitiesService: ResponsibilitiesService,
  ) {}

  /**
   * Who carries which duty — for everybody; with «who appointed him and
   * when» for the administrator, who keeps that record (see
   * PublicResponsibility).
   */
  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResponsibilityView[] | PublicResponsibility[]> {
    const all = await this.responsibilitiesService.findAll(tenantId);
    return user.role === UserRole.ADMIN ? all : all.map(publicResponsibility);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  assign(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssignResponsibilityDto,
  ) {
    return this.responsibilitiesService.assign(tenantId, dto, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':type/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @TenantId() tenantId: string,
    @Param('type', new ParseEnumPipe(ResponsibilityType))
    type: ResponsibilityType,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.responsibilitiesService.revoke(tenantId, type, userId);
  }
}
