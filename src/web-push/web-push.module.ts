import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebPushService } from './web-push.service';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WebPushSubscription])],
  providers: [WebPushService],
  exports: [WebPushService],
})
export class WebPushModule {}
