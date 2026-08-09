import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AuditRevertService } from './audit-revert.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';

/**
 * «Вернуть как было» — reading the half of the journal nobody read.
 *
 * Two routes on purpose: one that says what WOULD happen, one that does it.
 * A revert can quietly undo somebody else's later work, so the reader is shown
 * the change and told whether the record was touched since, and only then
 * decides.
 */
@Controller('journal')
export class AuditRevertController {
  constructor(private readonly service: AuditRevertService) {}

  @Get(':id/revert')
  preview(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.preview(tenantId, id, user);
  }

  @Post(':id/revert')
  @HttpCode(HttpStatus.NO_CONTENT)
  revert(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revert(tenantId, id, user);
  }
}
