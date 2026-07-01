import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { OverrideStatusDto } from './dto/override-status.dto';
import { GrantAccessDto } from './dto/grant-access.dto';
import { UpdateAccessDto } from './dto/update-access.dto';
import { redactPrivateFields } from './publisher-privacy';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

@Controller('publishers')
@UseGuards(RolesGuard)
export class PublishersController {
  constructor(private readonly publishersService: PublishersService) {}

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Patch(':id/status')
  overrideStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideStatusDto,
  ) {
    return this.publishersService.overrideStatus(tenantId, user, id, dto);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Delete(':id/status-override')
  clearOverride(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.clearOverride(tenantId, user, id);
  }

  /**
   * Directory list. Any authenticated member may list publishers so the
   * scheduling/group pickers work, but only those who may see private data
   * (admins, elders, or members granted access) receive the private fields.
   * For everyone else the rows are redacted to a name-and-scheduling roster
   * and removed publishers are excluded entirely.
   */
  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryPublishersDto,
  ) {
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    if (!privileged) {
      query.includeRemoved = false;
    }
    const result = await this.publishersService.findAll(tenantId, query);
    if (privileged) {
      return result;
    }
    return { ...result, data: result.data.map(redactPrivateFields) };
  }

  @Get(':id')
  async findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    if (!privileged) {
      throw new ForbiddenException(
        'Publisher cards are visible to admins, elders, and members granted ' +
          'access to private data.',
      );
    }
    const publisher = await this.publishersService.findOne(tenantId, id);
    const lastEditedByName = await this.publishersService.resolveEditorName(
      tenantId,
      publisher.lastEditedById,
    );
    return { ...publisher, lastEditedByName };
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/access')
  getAccess(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.getAccess(tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/access')
  grantAccess(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantAccessDto,
  ) {
    return this.publishersService.grantAccess(tenantId, id, dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/access')
  updateAccess(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessDto,
  ) {
    return this.publishersService.updateAccess(tenantId, id, dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/access/resend-invite')
  resendInvite(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.resendInvite(tenantId, id);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreatePublisherDto) {
    return this.publishersService.create(tenantId, dto);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublisherDto,
  ) {
    return this.publishersService.update(tenantId, id, dto, user?.id);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post(':id/remove')
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemovePublisherDto,
  ) {
    return this.publishersService.remove(tenantId, id, dto);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.restore(tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  purge(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.publishersService.purge(tenantId, id);
  }
}
