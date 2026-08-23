import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PublicTalksService } from './public-talks.service';
import { CreatePublicTalkDto } from './dto/create-public-talk.dto';
import { UpdatePublicTalkDto } from './dto/update-public-talk.dto';
import { BulkImportDto } from './dto/bulk-import.dto';
import { RetireMissingDto } from './dto/retire-missing.dto';
import { RetirementPreviewDto } from './dto/retirement-preview.dto';
import { LiftRestrictionDto } from './dto/lift-restriction.dto';
import { parseRetirementList } from './retirement-list';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('public-talks')
export class PublicTalksController {
  constructor(private readonly service: PublicTalksService) {}

  @Get()
  list(
    @TenantId() congregationId: string,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.list(congregationId, {
      search,
      includeInactive: includeInactive === 'true',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** When the catalogue was last imported, and by whom. */
  @Get('last-import')
  lastImport(@TenantId() congregationId: string) {
    return this.service.lastImport(congregationId);
  }

  /**
   * Retire the talks a new catalogue no longer lists — a deliberate act,
   * separate from importing, because it answers «какие речи больше не
   * говорим» and that must not happen by accident.
   */
  /**
   * What retiring these numbers would mean — titles, and the weeks where the
   * talks are still promised. Read-only: nothing is retired by asking.
   */
  /** The last time talks were set aside, and on what grounds. */
  @Get('last-retirement')
  lastRetirement(@TenantId() congregationId: string) {
    return this.service.lastRetirement(congregationId);
  }

  @Post('retirement-preview')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  retirementPreview(
    @Body() dto: RetirementPreviewDto,
    @TenantId() congregationId: string,
  ) {
    const { numbers } = parseRetirementList(dto.text ?? '');
    return this.service.previewRetirement(
      congregationId,
      dto.numbers ?? numbers,
      dto.from,
    );
  }

  /** Every decision about the catalogue, newest first. */
  @Get('history')
  history(@TenantId() congregationId: string) {
    return this.service.catalogueHistory(congregationId);
  }

  /**
   * Lift a restriction because a letter said so. Its own act, not an edit:
   * a year later the journal must answer «почему вернули» as well as «почему
   * сняли».
   */
  @Post('lift-restriction')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  liftRestriction(
    @Body() dto: LiftRestrictionDto,
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.liftRestriction(
      congregationId,
      dto.numbers,
      user.id,
      dto.reason,
    );
  }

  @Post('retire-missing')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  retireMissing(
    @Body() dto: RetireMissingDto,
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.retireMissing(
      congregationId,
      dto.numbers,
      user.id,
      dto.from,
      dto.until,
      dto.reason,
    );
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  create(@Body() dto: CreatePublicTalkDto) {
    return this.service.create(dto);
  }

  @Post('bulk-import')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  bulkImport(
    @Body() dto: BulkImportDto,
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.bulkImport(dto.text, congregationId, user.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublicTalkDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivate(id);
  }

  @Post(':id/reactivate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reactivate(id);
  }
}
