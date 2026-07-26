import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from '../entities/notification-outbox.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { Congregation } from '../entities/congregation.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationOutbox,
      NotificationPreference,
      Congregation,
    ]),
    PushNotificationsModule,
  ],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
