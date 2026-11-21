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
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { EVENT_TYPE_RESPONSIBILITY } from '../common/guards/assignment-section.guard';
import { EventType } from '../common/enums/event-type.enum';
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
 * WRITING is for whoever edits the Memorial's parts — the coordinator of the
 * body of elders, his assistant and the administrator (Lionel, 21 November
 * 2026). Until then any elder wrote and published the programme while only
 * the coordinator could edit its parts: two rules for one evening. Every
 * elder still READS the draft.
 */
const MEMORIAL_WRITERS = EVENT_TYPE_RESPONSIBILITY[EventType.MEMORIAL];
@Controller('memorial')
export class MemorialController {
  constructor(private readonly service: MemorialService) {}

  /** Every Memorial on record, newest first. */
  @Get()
  list(@TenantId() tenantId: string) {
    return this.service.list(tenantId);
  }

  /** A draft goes to the elders and the admins: they plan it together. */
  @Get(':id')
  sheet(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const planner =
      user.role === UserRole.ADMIN || user.role === UserRole.ELDER;
    return this.service.sheet(tenantId, id, planner);
  }

  /** Fill an empty Memorial from last year's, or from the template. */
  @Post(':id/prepare')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
  prepare(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.prepare(tenantId, id);
  }

  @Post(':id/lines')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
  addLine(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemorialLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addLine(tenantId, id, dto, user.id);
  }

  @Patch('lines/:lineId')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
  updateLine(
    @TenantId() tenantId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateMemorialLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateLine(tenantId, lineId, dto, user.id);
  }

  @Post(':id/reorder')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
  reorder(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderMemorialDto,
  ) {
    return this.service.reorder(tenantId, id, dto.section, dto.orderedIds);
  }

  @Delete('lines/:lineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
  removeLine(
    @TenantId() tenantId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeLine(tenantId, lineId, user.id);
  }

  @Post('lines/:lineId/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
  restoreLine(
    @TenantId() tenantId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.service.restoreLine(tenantId, lineId);
  }

  @Patch(':id/theme')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
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
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(...MEMORIAL_WRITERS)
  publish(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.publish(tenantId, id, user.id);
  }
}
