import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PairAgreement } from '../entities/pair-agreement.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { Duty } from '../entities/duty.entity';
import { Absence } from '../entities/absence.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { WeekRulesModule } from '../common/week-rules.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PairPrepController } from './pair-prep.controller';
import { PairPrepService } from './pair-prep.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PairAgreement,
      Assignment,
      Publisher,
      User,
      Duty,
      Absence,
      CleaningAssignment,
      FieldServiceMeeting,
    ]),
    WeekRulesModule,
    CongregationClockModule,
    NotificationsModule,
  ],
  controllers: [PairPrepController],
  providers: [PairPrepService],
  exports: [PairPrepService],
})
export class PairPrepModule {}
