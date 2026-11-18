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
import { CoVisitNoticeService } from './co-visit-notice.service';
import { CreateCoVisitItemDto } from './dto/create-co-visit-item.dto';
import { UpdateCoVisitItemDto } from './dto/update-co-visit-item.dto';
import { ApplyCoVisitTemplateDto } from './dto/apply-co-visit-template.dto';
import { UndoClearWifeDto } from './dto/undo-clear-wife.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
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
  constructor(
    private readonly service: CoVisitItemsService,
    private readonly notices: CoVisitNoticeService,
  ) {}

  /** The signed-in member's own slice of upcoming visits (any role). */
  @Get('mine')
  mine(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mine(congregationId, user);
  }

  /**
   * The field-service meetings of upcoming visits — announced to everyone, so
   * no role guard. Narrow by design: the full item list below stays
   * elder-only because it also carries hosts, addresses and phone numbers.
   */
  @Get('field-service')
  fieldService(@TenantId() congregationId: string) {
    return this.service.fieldService(congregationId);
  }

  /** Hosting rotation across all visits (for the host picker). */
  @Get('host-stats')
  async hostStats(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanViewSchedule(congregationId, user);
    return this.service.hostStats(
      congregationId,
      await this.service.isElder(congregationId, user),
    );
  }

  /**
   * What the reader of the schedule is: an elder sees and plans shepherding
   * calls, anyone else only the time they take (18 November 2026).
   */
  @Get('reader')
  async reader(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanViewSchedule(congregationId, user);
    return { elder: await this.service.isElder(congregationId, user) };
  }

  /** Elders, the admin, and those who plan the visit (see the service). */
  @Get()
  async list(
    @TenantId() congregationId: string,
    @Query('specialEventId', ParseUUIDPipe) specialEventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanViewSchedule(congregationId, user);
    return this.service.list(congregationId, specialEventId, user);
  }

  /**
   * Where the visit's publishing stands, and who would hear what if it were
   * said now — for those who plan it (18 November 2026).
   */
  @Get('publication')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  async publication(
    @TenantId() congregationId: string,
    @Query('specialEventId', ParseUUIDPipe) specialEventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.publication(
      congregationId,
      specialEventId,
      user.uiLanguage,
      await this.service.isElder(congregationId, user),
    );
  }

  /** Publish the week: from now on it is seen, and it speaks for itself. */
  @Post('publish')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  publish(
    @TenantId() congregationId: string,
    @Body() dto: ApplyCoVisitTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.publish(congregationId, dto.specialEventId, user.id);
  }

  /** What starting from the last visit would create — those who may read it. */
  @Get('template')
  async templatePreview(
    @TenantId() congregationId: string,
    @Query('specialEventId', ParseUUIDPipe) specialEventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanViewSchedule(congregationId, user);
    return this.service.templatePreview(congregationId, specialEventId);
  }

  /** Fill an empty visit week from the last one — those who plan it. */
  @Post('template')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  applyTemplate(
    @TenantId() congregationId: string,
    @Body() dto: ApplyCoVisitTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.applyTemplate(
      congregationId,
      dto.specialEventId,
      user.id,
    );
  }

  /**
   * The overseer's wife does not come: clear her rows out of the week in
   * one undoable step (18 November 2026).
   */
  @Post('clear-wife')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  clearWife(
    @TenantId() congregationId: string,
    @Body() dto: ApplyCoVisitTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.clearWife(congregationId, dto.specialEventId, user.id);
  }

  /** Undo of `clear-wife`: exactly the rows it touched. */
  @Post('clear-wife/undo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  unclearWife(
    @TenantId() congregationId: string,
    @Body() dto: UndoClearWifeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.unclearWife(
      congregationId,
      dto.specialEventId,
      dto.removed,
      dto.unjoined,
      user.id,
    );
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(congregationId, id, user);
  }

  /** Put a removed item back — the same right as removing it. */
  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ResponsibilityType.BODY_COORDINATOR,
  )
  restore(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.restore(congregationId, id, user);
  }
}
