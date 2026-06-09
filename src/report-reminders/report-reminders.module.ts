import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Congregation } from '../entities/congregation.entity';
import { User } from '../entities/user.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { ReportRemindersService } from './report-reminders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Publisher,
      ServiceReport,
      ServiceGroup,
      Responsibility,
      Congregation,
      User,
    ]),
    PushNotificationsModule,
  ],
  providers: [ReportRemindersService],
})
export class ReportRemindersModule {}
