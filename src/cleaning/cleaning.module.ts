import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { CleaningRemindersService } from './cleaning-reminders.service';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Congregation } from '../entities/congregation.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { ReminderLog } from '../entities/reminder-log.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [
    AuditLogModule,
    TypeOrmModule.forFeature([
      CleaningAssignment,
      ServiceGroup,
      Publisher,
      Responsibility,
      Congregation,
      MeetingSettings,
      ReminderLog,
    ]),
    PushNotificationsModule,
  ],
  controllers: [CleaningController],
  providers: [CleaningService, CleaningRemindersService, ResponsibilityGuard],
  exports: [CleaningRemindersService],
})
export class CleaningModule {}
