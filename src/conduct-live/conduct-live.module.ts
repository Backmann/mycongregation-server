import { WeekRulesModule } from '../common/week-rules.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { MeetingDayService } from '../conduct-runs/meeting-day.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConductLive } from '../entities/conduct-live.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Duty } from '../entities/duty.entity';
import { ConductLiveController } from './conduct-live.controller';
import { ConductLiveService } from './conduct-live.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConductLive, Assignment, Publisher, Duty]),
    WeekRulesModule,
    CongregationClockModule,
  ],
  controllers: [ConductLiveController],
  providers: [ConductLiveService, MeetingDayService],
  exports: [ConductLiveService],
})
export class ConductLiveModule {}
