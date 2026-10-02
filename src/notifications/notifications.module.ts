import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from '../entities/notification-outbox.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { NotificationReachService } from './notification-reach.service';
import { NotificationsController } from './notifications.controller';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { PushToken } from '../entities/push-token.entity';
import { User } from '../entities/user.entity';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationOutbox,
      NotificationPreference,
      Assignment,
      Publisher,
      PushToken,
      User,
      WebPushSubscription,
    ]),
    PushNotificationsModule,
    CongregationClockModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationReachService],
  exports: [NotificationsService, NotificationReachService],
})
export class NotificationsModule {}
