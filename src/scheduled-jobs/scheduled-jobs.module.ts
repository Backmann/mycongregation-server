import { Module } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { AdminController } from './admin.controller';
import { PublishersModule } from '../publishers/publishers.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CleaningModule } from '../cleaning/cleaning.module';
import { MemorialModule } from '../memorial/memorial.module';
import { SpecialEventsModule } from '../special-events/special-events.module';
import { TasksModule } from '../tasks/tasks.module';
import { FieldServiceMeetingsModule } from '../field-service-meetings/field-service-meetings.module';

@Module({
  imports: [
    TasksModule,
    FieldServiceMeetingsModule,
    PublishersModule,
    PushNotificationsModule,
    NotificationsModule,
    AuditLogModule,
    CleaningModule,
    MemorialModule,
    SpecialEventsModule,
  ],
  controllers: [AdminController],
  providers: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
