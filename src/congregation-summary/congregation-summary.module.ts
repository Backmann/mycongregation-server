import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { ReadinessModule } from '../readiness/readiness.module';
import { AbsencesModule } from '../absences/absences.module';
import { MeetingSettingsModule } from '../meeting-settings/meeting-settings.module';
import { PublishersModule } from '../publishers/publishers.module';
import { CongregationSummaryController } from './congregation-summary.controller';
import { CongregationSummaryService } from './congregation-summary.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Responsibility,
      Publisher,
      ServiceGroup,
      ElderTask,
      TalkExchange,
      CleaningAssignment,
    ]),
    CongregationClockModule,
    ReadinessModule,
    AbsencesModule,
    MeetingSettingsModule,
    PublishersModule,
  ],
  controllers: [CongregationSummaryController],
  providers: [CongregationSummaryService],
})
export class CongregationSummaryModule {}
