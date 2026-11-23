import { WeekRulesModule } from '../common/week-rules.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { MeetingDayService } from './meeting-day.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConductRun } from '../entities/conduct-run.entity';
import { ConductLive } from '../entities/conduct-live.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Duty } from '../entities/duty.entity';
import { ConductAverage } from '../entities/conduct-average.entity';
import { Song } from '../entities/song.entity';
import { ConductAveragesService } from './conduct-averages.service';
import { ConductRunsController } from './conduct-runs.controller';
import { ConductRunsService } from './conduct-runs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConductRun,
      ConductLive,
      Assignment,
      Publisher,
      Duty,
      ConductAverage,
      Song,
    ]),
    WeekRulesModule,
    CongregationClockModule,
  ],
  controllers: [ConductRunsController],
  providers: [ConductRunsService, MeetingDayService, ConductAveragesService],
  exports: [ConductRunsService],
})
export class ConductRunsModule {}
