import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicTalk } from '../entities/public-talk.entity';
import { Assignment } from '../entities/assignment.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { PublicTalksController } from './public-talks.controller';
import { PublicTalksService } from './public-talks.service';
import { RestrictedScheduleService } from './restricted-schedule.service';
import { Publisher } from '../entities/publisher.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { Responsibility } from '../entities/responsibility.entity';
import { CatalogueKeeperGuard } from './catalogue-keeper.guard';

@Module({
  imports: [
    AuditLogModule,
    CongregationClockModule,
    TypeOrmModule.forFeature([
      PublicTalk,
      Assignment,
      TalkExchange,
      MeetingSettings,
      Publisher,
      ExternalCongregation,
      // Read by CatalogueKeeperGuard: the coordinator's duty opens the
      // doors of setting talks aside to somebody who is not an elder.
      Responsibility,
    ]),
  ],
  controllers: [PublicTalksController],
  providers: [
    PublicTalksService,
    RestrictedScheduleService,
    CatalogueKeeperGuard,
  ],
  exports: [PublicTalksService],
})
export class PublicTalksModule {}
