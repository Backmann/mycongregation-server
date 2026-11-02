import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartWeek } from '../entities/cart-week.entity';
import { CartDay } from '../entities/cart-day.entity';
import { CartCancellation } from '../entities/cart-cancellation.entity';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { Congregation } from '../entities/congregation.entity';
import { CartRemindersService } from './cart-reminders.service';
import { CartRequest } from '../entities/cart-request.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CartLocation } from '../entities/cart-location.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { CartWeeksService } from './cart-weeks.service';
import { CartWeeksController } from './cart-weeks.controller';
import { CartDaysController } from './cart-days.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    CongregationClockModule,
    TypeOrmModule.forFeature([
      CartWeek,
      CartDay,
      CartCancellation,
      AuxiliaryPioneer,
      Congregation,
      CartRequest,
      CartAssignment,
      CartLocation,
      Publisher,
      Responsibility,
    ]),
    PushNotificationsModule,
    NotificationsModule,
    AuditLogModule,
  ],
  controllers: [CartWeeksController, CartDaysController],
  providers: [CartWeeksService, CartRemindersService, ResponsibilityGuard],
  exports: [CartWeeksService, CartRemindersService],
})
export class CartWeeksModule {}
