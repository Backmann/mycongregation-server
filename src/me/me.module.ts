import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Publisher } from '../entities/publisher.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { MeService } from './me.service';
import { MeController } from './me.controller';
import { DataRightsService } from './data-rights.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Publisher,
      Assignment,
      Duty,
      CleaningAssignment,
      FieldServiceMeeting,
      TalkExchange,
      ExternalCongregation,
      PublicTalk,
      CartAssignment,
      CoVisitItem,
    ]),
  ],
  controllers: [MeController],
  providers: [MeService, DataRightsService],
})
export class MeModule {}
