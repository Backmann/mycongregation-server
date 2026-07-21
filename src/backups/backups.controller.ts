import {
  Controller,
  Get,
  Logger,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * Admin-only access to the encrypted database backups. Listing the status is
 * harmless; downloading streams a GPG-encrypted file (unreadable without the
 * offline private key). Each download is recorded twice: in the application
 * log, and in the journal an administrator can actually read.
 *
 * It belongs in the journal because this is the single most consequential
 * thing an administrator can do — the whole database leaves the server. The
 * old reason for leaving it out was that entityId is a uuid column and a
 * backup filename is not one; the congregation's own id goes there instead,
 * with the filename in the detail, which is how the other event entries with
 * no single record behind them are written too.
 */
@Controller('admin/backups')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class BackupsController {
  private readonly logger = new Logger(BackupsController.name);

  constructor(
    private readonly backups: BackupsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  status() {
    return this.backups.status();
  }

  @Get(':name')
  async download(
    @Param('name') name: string,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const { file, size } = await this.backups.openForDownload(name);
    this.logger.warn(
      `[BackupDownload] user=${user.id} congregation=${user.congregationId} file=${name} bytes=${size}`,
    );
    await this.auditLog.logEvent({
      tenantId: user.congregationId,
      entityType: 'backup',
      entityId: user.congregationId,
      action: 'DOWNLOAD',
      detail: { file: name, bytes: size },
    });
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(size),
    });
    return file;
  }
}
