import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartWeek } from '../entities/cart-week.entity';
import { CartSlot } from '../entities/cart-slot.entity';
import { CartRequest } from '../entities/cart-request.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CartLocation } from '../entities/cart-location.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { CartWeeksService } from './cart-weeks.service';
import { CartWeeksController } from './cart-weeks.controller';
import { CartSlotsController } from './cart-slots.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CartWeek,
      CartSlot,
      CartRequest,
      CartAssignment,
      CartLocation,
      Publisher,
      Responsibility,
    ]),
    PushNotificationsModule,
  ],
  controllers: [CartWeeksController, CartSlotsController],
  providers: [CartWeeksService, ResponsibilityGuard],
  exports: [CartWeeksService],
})
export class CartWeeksModule {}
