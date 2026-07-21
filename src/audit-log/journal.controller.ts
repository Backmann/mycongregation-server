import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { JournalService } from './journal.service';

export class ListJournalDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  /** Everything touching this person, whether they acted or were acted upon. */
  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsIn(['CREATE', 'UPDATE', 'DELETE', 'VIEW', 'DOWNLOAD', 'DENY'])
  action?: string;
}

/**
 * The journal, for administrators only.
 *
 * Elders keep the narrower activity feed; this shows everything recorded for
 * the congregation, including who looked at a record card and who was refused.
 * That is a level of visibility that belongs with whoever answers for the
 * congregation's data, not with everyone who can edit a schedule.
 *
 * Read-only by design and by omission: there is no endpoint to edit or delete
 * an entry, because a journal an administrator can rewrite proves nothing on
 * the day it is needed. Entries leave only by age or by an erasure request.
 */
@Controller('journal')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: ListJournalDto) {
    return this.journal.find(tenantId, query);
  }
}
