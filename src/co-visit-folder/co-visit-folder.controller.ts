import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CoVisitFolderService } from './co-visit-folder.service';
import {
  FolderAnswerDto,
  FolderMarkDto,
  FolderOnDto,
  FolderS62Dto,
} from './dto/folder.dto';

/**
 * The folder for the circuit overseer, form S-61 (17 November 2026). Who
 * may do what is decided in the service: the coordinator of the body of
 * elders, the secretary and the service overseer — everything; another
 * elder — section 1 to read.
 */
@Controller('co-visit-folder')
export class CoVisitFolderController {
  constructor(private readonly service: CoVisitFolderService) {}

  @Get(':eventId')
  get(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.get(tenantId, user, eventId);
  }

  @Put(':eventId/marks/:key')
  mark(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('key') key: string,
    @Body() dto: FolderMarkDto,
  ) {
    return this.service.mark(
      tenantId,
      user,
      eventId,
      key,
      dto.state,
      dto.stamp ?? null,
    );
  }

  @Put(':eventId/s62')
  s62(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: FolderS62Dto,
  ) {
    return this.service.setS62(tenantId, user, eventId, dto.what, dto.on);
  }

  @Put(':eventId/answers/:q')
  answer(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('q', ParseIntPipe) q: number,
    @Body() dto: FolderAnswerDto,
  ) {
    return this.service.answer(tenantId, user, eventId, q, dto.answer);
  }

  @Put(':eventId/handed-over')
  handedOver(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: FolderOnDto,
  ) {
    return this.service.handOver(tenantId, user, eventId, dto.on);
  }

  @Post(':eventId/files-deleted')
  filesDeleted(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.filesDeleted(tenantId, user, eventId);
  }

  /** 2.1 — one group's S-21 for both service years; `none` for no group. */
  @Get(':eventId/s21/:group')
  s21(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('group') group: string,
  ) {
    if (group !== 'none')
      new ParseUUIDPipe().transform(group, { type: 'param' });
    return this.service.s21Group(tenantId, user, eventId, group);
  }

  /** 2.5 — for the file only; no screen shows it. */
  @Get(':eventId/contacts')
  contacts(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.contacts(tenantId, user, eventId);
  }
}
