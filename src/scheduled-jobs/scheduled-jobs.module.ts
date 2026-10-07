import { Module } from '@nestjs/common';
import { AnnualReportModule } from '../annual-report/annual-report.module';
import { ServiceReportsModule } from '../service-reports/service-reports.module';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { AdminController } from './admin.controller';
import { PublishersModule } from '../publishers/publishers.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { AssignmentRemindersModule } from '../assignment-reminders/assignment-reminders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CleaningModule } from '../cleaning/cleaning.module';
import { MemorialModule } from '../memorial/memorial.module';
import { SpecialEventsModule } from '../special-events/special-events.module';
import { TasksModule } from '../tasks/tasks.module';
import { FieldServiceMeetingsModule } from '../field-service-meetings/field-service-meetings.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TasksModule,
    FieldServiceMeetingsModule,
    PublishersModule,
    PushNotificationsModule,
    NotificationsModule,
    AssignmentRemindersModule,
    AuditLogModule,
    CleaningModule,
    MemorialModule,
    SpecialEventsModule,
    AnnualReportModule,
    ServiceReportsModule,
    UsersModule,
  ],
  controllers: [AdminController],
  providers: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
