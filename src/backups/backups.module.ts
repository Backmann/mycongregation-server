import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

// No AuditLogModule: downloads are read events, logged to the app log.
@Module({
  controllers: [BackupsController],
  providers: [BackupsService],
})
export class BackupsModule {}
