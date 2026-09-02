import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { MemorialItem } from '../entities/memorial-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { MeService } from './me.service';
import { MeController } from './me.controller';
import { DataRightsService } from './data-rights.service';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TasksModule,
    CongregationClockModule,
    NotificationsModule,
    AuditLogModule,
    TypeOrmModule.forFeature([
      Publisher,
      ServiceGroup,
      Assignment,
      Duty,
      CleaningAssignment,
      FieldServiceMeeting,
      TalkExchange,
      ExternalCongregation,
      PublicTalk,
      CartAssignment,
      CoVisitItem,
      MemorialItem,
      SpecialEvent,
    ]),
  ],
  controllers: [MeController],
  providers: [MeService, DataRightsService],
})
export class MeModule {}
