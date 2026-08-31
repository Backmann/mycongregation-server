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
  UseGuards,
} from '@nestjs/common';
import { MemorialService } from './memorial.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AddMemorialLineDto } from './dto/add-memorial-line.dto';
import { UpdateMemorialLineDto } from './dto/update-memorial-line.dto';
import { ReorderMemorialDto } from './dto/reorder-memorial.dto';
import { SetMemorialThemeDto } from './dto/set-memorial-theme.dto';

/**
 * The Memorial programme.
 *
 * READING is open to the whole congregation: the sheet says who is doing what
 * on the evening everybody attends, and a publisher looking for his own line
 * should not have to ask an elder for it.
 *
 * WRITING is for the body of elders and the admins — the decision of
 * 29 August. No separate responsibility: the programme is settled by the body
 * together, not by one appointed brother, so a role is the honest test here.
 */
@Controller('memorial')
export class MemorialController {
  constructor(private readonly service: MemorialService) {}

  /** Every Memorial on record, newest first. */
  @Get()
  list(@TenantId() tenantId: string) {
    return this.service.list(tenantId);
  }

  @Get(':id')
  sheet(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.sheet(tenantId, id);
  }

  /** Fill an empty Memorial from last year's, or from the template. */
  @Post(':id/prepare')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  prepare(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.prepare(tenantId, id);
  }

  /** Lay out one empty section from the template — asked for, never automatic. */
  @Post(':id/prepare/:section')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  prepareSection(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('section') section: string,
  ) {
    return this.service.prepareSection(tenantId, id, section);
  }

  @Post(':id/lines')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  addLine(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemorialLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addLine(tenantId, id, dto, user.id);
  }

  @Patch('lines/:lineId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  updateLine(
    @TenantId() tenantId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateMemorialLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateLine(tenantId, lineId, dto, user.id);
  }

  @Post(':id/reorder')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  reorder(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderMemorialDto,
  ) {
    return this.service.reorder(tenantId, id, dto.section, dto.orderedIds);
  }

  @Delete('lines/:lineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  removeLine(
    @TenantId() tenantId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeLine(tenantId, lineId, user.id);
  }

  @Post('lines/:lineId/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  restoreLine(
    @TenantId() tenantId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.service.restoreLine(tenantId, lineId);
  }

  @Patch(':id/theme')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  setTheme(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMemorialThemeDto,
  ) {
    return this.service.setTheme(
      tenantId,
      id,
      dto.theme ?? null,
      dto.themeUrl ?? null,
    );
  }

  @Post(':id/publish')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  publish(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.publish(tenantId, id, user.id);
  }
}
