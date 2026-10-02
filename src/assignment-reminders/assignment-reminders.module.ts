import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Absence } from '../entities/absence.entity';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentNotice } from '../entities/assignment-notice.entity';
import { Congregation } from '../entities/congregation.entity';
import { Duty } from '../entities/duty.entity';
import { Publisher } from '../entities/publisher.entity';
import { PushToken } from '../entities/push-token.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { WeekRulesModule } from '../common/week-rules.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReadinessModule } from '../readiness/readiness.module';
import { AssignmentRemindersService } from './assignment-reminders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Absence,
      Assignment,
      AssignmentNotice,
      Congregation,
      Duty,
      Publisher,
      PushToken,
      Responsibility,
      User,
      WebPushSubscription,
    ]),
    WeekRulesModule,
    ReadinessModule,
    NotificationsModule,
  ],
  providers: [AssignmentRemindersService],
  exports: [AssignmentRemindersService],
})
export class AssignmentRemindersModule {}
