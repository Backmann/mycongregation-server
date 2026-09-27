import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
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
import { SpecialTalkNotificationsService } from './special-talk-notifications.service';
import { User } from '../entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CongregationClockModule } from '../common/congregation-clock.module';

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
      User,
    ]),
    AuditLogModule,
    NotificationsModule,
    CongregationClockModule,
  ],
  controllers: [TalkExchangeController],
  providers: [TalkExchangeService, SpecialTalkNotificationsService],
  exports: [TalkExchangeService],
})
export class TalkExchangeModule {}
