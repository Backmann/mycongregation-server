import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from '../entities/notification-outbox.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationOutbox, NotificationPreference]),
    PushNotificationsModule,
    CongregationClockModule,
  ],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
