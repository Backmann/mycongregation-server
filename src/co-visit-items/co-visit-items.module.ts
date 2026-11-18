import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoVisitItemsController } from './co-visit-items.controller';
import { CoVisitItemsService } from './co-visit-items.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { User } from '../entities/user.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuxiliaryPioneersModule } from '../auxiliary-pioneers/auxiliary-pioneers.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoVisitTold } from '../entities/co-visit-told.entity';
import { PushToken } from '../entities/push-token.entity';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { CoVisitNoticeService } from './co-visit-notice.service';

@Module({
  imports: [
    CongregationClockModule,
    TypeOrmModule.forFeature([
      CoVisitItem,
      SpecialEvent,
      Responsibility,
      User,
      Publisher,
      CoVisitTold,
      PushToken,
      WebPushSubscription,
    ]),
    AuxiliaryPioneersModule,
    AuditLogModule,
    NotificationsModule,
  ],
  controllers: [CoVisitItemsController],
  providers: [
    CoVisitItemsService,
    CoVisitNoticeService,
    RolesGuard,
    ResponsibilityGuard,
  ],
  exports: [CoVisitItemsService, CoVisitNoticeService],
})
export class CoVisitItemsModule {}
