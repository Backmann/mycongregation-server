import { CoVisitTemplateModule } from '../special-events/co-visit-template.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssignmentRemindersModule } from '../assignment-reminders/assignment-reminders.module';
import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';
import { LocalNeedsModule } from '../local-needs/local-needs.module';
import { DutiesModule } from '../duties/duties.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AssignmentSectionGuard } from '../common/guards/assignment-section.guard';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';
import { ProgrammeFreezeModule } from './programme-freeze.module';
import { ProgrammeNotice } from '../entities/programme-notice.entity';
import { WeekRulesModule } from '../common/week-rules.module';
import { ProgrammeNoticeService } from './programme-notice.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assignment,
      Responsibility,
      Publisher,
      Congregation,
      SpecialEvent,
      ProgrammeNotice,
    ]),
    PushNotificationsModule,
    NotificationsModule,
    AssignmentRemindersModule,
    TalkExchangeModule,
    LocalNeedsModule,
    DutiesModule,
    // Часы собрания: «неделя прошла» судится по местному времени.
    CongregationClockModule,
    AuditLogModule,
    CoVisitTemplateModule,
    ProgrammeFreezeModule,
    WeekRulesModule,
  ],
  controllers: [AssignmentsController],
  providers: [
    AssignmentsService,
    ProgrammeNoticeService,
    AssignmentSectionGuard,
  ],
  exports: [AssignmentsService, ProgrammeNoticeService],
})
export class AssignmentsModule {}
