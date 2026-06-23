import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';
import { AssignmentSectionGuard } from '../common/guards/assignment-section.guard';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, Responsibility]),
    PushNotificationsModule,
    TalkExchangeModule,
  ],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentSectionGuard],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
