import { Module } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { AdminController } from './admin.controller';
import { PublishersModule } from '../publishers/publishers.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [PublishersModule, PushNotificationsModule, AuditLogModule],
  controllers: [AdminController],
  providers: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
