import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';
import { LocalNeedsModule } from '../local-needs/local-needs.module';
import { DutiesModule } from '../duties/duties.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AssignmentSectionGuard } from '../common/guards/assignment-section.guard';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assignment,
      Responsibility,
      Publisher,
      Congregation,
    ]),
    PushNotificationsModule,
    NotificationsModule,
    TalkExchangeModule,
    LocalNeedsModule,
    DutiesModule,
    AuditLogModule,
  ],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentSectionGuard],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
