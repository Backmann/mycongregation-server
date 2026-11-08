import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentNotice } from '../entities/assignment-notice.entity';
import { Congregation } from '../entities/congregation.entity';
import { Duty } from '../entities/duty.entity';
import { NotHeldAlert } from '../entities/not-held-alert.entity';
import { NotHeldClearance } from '../entities/not-held-clearance.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { User } from '../entities/user.entity';
import { AssignmentsModule } from '../assignments/assignments.module';
import { ProgrammeFreezeModule } from '../assignments/programme-freeze.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { WeekRulesModule } from '../common/week-rules.module';
import { LocalNeedsModule } from '../local-needs/local-needs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';
import { NotHeldController } from './not-held.controller';
import { NotHeldService } from './not-held.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assignment,
      AssignmentNotice,
      Congregation,
      Duty,
      NotHeldAlert,
      NotHeldClearance,
      Publisher,
      Responsibility,
      SpecialEvent,
      User,
    ]),
    AssignmentsModule,
    ProgrammeFreezeModule,
    AuditLogModule,
    CongregationClockModule,
    WeekRulesModule,
    LocalNeedsModule,
    NotificationsModule,
    TalkExchangeModule,
  ],
  controllers: [NotHeldController],
  providers: [NotHeldService],
  exports: [NotHeldService],
})
export class NotHeldModule {}
