import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Assignment } from '../entities/assignment.entity';
import { SpecialEventsService } from './special-events.service';
import { SpecialEventsController } from './special-events.controller';
import { CoVisitTemplateModule } from './co-visit-template.module';
import { MemorialModule } from '../memorial/memorial.module';
import { EventNotificationsService } from './event-notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../entities/user.entity';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CongregationClockModule } from '../common/congregation-clock.module';

import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';

@Module({
  imports: [
    CongregationClockModule,
    TypeOrmModule.forFeature([SpecialEvent, Responsibility, Assignment, User]),
    NotificationsModule,
    AuditLogModule,
    CoVisitTemplateModule,
    MemorialModule,
    TalkExchangeModule,
  ],
  controllers: [SpecialEventsController],
  providers: [
    SpecialEventsService,
    EventNotificationsService,
    ResponsibilityGuard,
  ],
  exports: [SpecialEventsService, EventNotificationsService],
})
export class SpecialEventsModule {}
