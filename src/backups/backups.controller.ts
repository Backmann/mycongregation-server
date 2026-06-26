import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BackupsService } from './backups.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * Admin-only access to the encrypted database backups. Listing the status is
 * harmless; downloading streams a GPG-encrypted file (unreadable without the
 * offline private key). Every download is recorded in the audit log because it
 * exports the full database (in encrypted form).
 */
@Controller('admin/backups')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  status() {
    return this.backups.status();
  }

  @Get(':name')
  async download(
    @Param('name') name: string,
    @Res({ passthrough: true }) res: Response,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const { file, size } = await this.backups.openForDownload(name);
    await this.audit.logCreate({
      tenantId,
      entityType: 'backup_download',
      entityId: name,
      actorUserId: user.id,
      after: { file: name, sizeBytes: size },
    });
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(size),
    });
    return file;
  }
}
