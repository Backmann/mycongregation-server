import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicTalk } from '../entities/public-talk.entity';
import { Assignment } from '../entities/assignment.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { PublicTalksController } from './public-talks.controller';
import { PublicTalksService } from './public-talks.service';

@Module({
  imports: [
    AuditLogModule,
    TypeOrmModule.forFeature([
      PublicTalk,
      Assignment,
      TalkExchange,
      MeetingSettings,
    ]),
  ],
  controllers: [PublicTalksController],
  providers: [PublicTalksService],
  exports: [PublicTalksService],
})
export class PublicTalksModule {}
