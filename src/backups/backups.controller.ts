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

/**
 * Admin-only access to the encrypted database backups. Listing the status is
 * harmless; downloading streams a GPG-encrypted file (unreadable without the
 * offline private key). Each download is logged to the application log
 * (captured by Better Stack) — a read event, so it is NOT written to the
 * mutation audit table (whose entityId column is a uuid).
 */
@Controller('admin/backups')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class BackupsController {
  private readonly logger = new Logger(BackupsController.name);

  constructor(private readonly backups: BackupsService) {}

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
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(size),
    });
    return file;
  }
}
