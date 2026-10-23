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
import { OutgoingTalkNotificationsService } from './outgoing-talk-notifications.service';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Congregation } from '../entities/congregation.entity';
import { TalkAttentionService } from './talk-attention.service';
import { TalkConsistencyService } from './talk-consistency.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { ProgrammeFreezeModule } from '../assignments/programme-freeze.module';

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
      Publisher,
      User,
      SpecialEvent,
      Congregation,
    ]),
    AuditLogModule,
    NotificationsModule,
    CongregationClockModule,
    // The programme's freeze: the journal stops writing into a week that is
    // already the record.
    ProgrammeFreezeModule,
  ],
  controllers: [TalkExchangeController],
  providers: [
    TalkExchangeService,
    SpecialTalkNotificationsService,
    OutgoingTalkNotificationsService,
    TalkAttentionService,
    TalkConsistencyService,
  ],
  exports: [TalkExchangeService, TalkAttentionService, TalkConsistencyService],
})
export class TalkExchangeModule {}
