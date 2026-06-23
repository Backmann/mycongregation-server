import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Absence } from '../entities/absence.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { TalkExchangeService } from './talk-exchange.service';
import { TalkExchangeController } from './talk-exchange.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TalkExchange,
      Assignment,
      Absence,
      VisitingSpeaker,
      ExternalCongregation,
      PublicTalk,
      Responsibility,
      MeetingSettings,
    ]),
  ],
  controllers: [TalkExchangeController],
  providers: [TalkExchangeService],
  exports: [TalkExchangeService],
})
export class TalkExchangeModule {}
