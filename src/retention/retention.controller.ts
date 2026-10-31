import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RetentionService } from './retention.service';

/**
 * What the retention rules would remove in the caller's congregation —
 * counts only, nothing is deleted. Administrators only for now; the yearly
 * review screen for the secretary (§19, January) comes with removal itself.
 */
@Controller('retention')
@UseGuards(RolesGuard)
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Roles(UserRole.ADMIN)
  @Get('preview')
  preview(@TenantId() tenantId: string) {
    return this.retention.preview(tenantId);
  }
}
