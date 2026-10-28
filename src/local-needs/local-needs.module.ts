import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocalNeedsTopic } from '../entities/local-needs-topic.entity';
import { LocalNeedsUse } from '../entities/local-needs-use.entity';
import { WeekRulesModule } from '../common/week-rules.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LocalNeedsRemindersService } from './local-needs-reminders.service';
import { Responsibility } from '../entities/responsibility.entity';
import { Assignment } from '../entities/assignment.entity';
import { Congregation } from '../entities/congregation.entity';
import { LocalNeedsService } from './local-needs.service';
import { LocalNeedsController } from './local-needs.controller';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LocalNeedsTopic,
      LocalNeedsUse,
      Responsibility,
      Assignment,
      Congregation,
    ]),
    WeekRulesModule,
    NotificationsModule,
    AuditLogModule,
    CongregationClockModule,
  ],
  controllers: [LocalNeedsController],
  providers: [LocalNeedsService, LocalNeedsRemindersService],
  exports: [LocalNeedsService, LocalNeedsRemindersService],
})
export class LocalNeedsModule {}
