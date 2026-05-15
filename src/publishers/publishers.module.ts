import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { PublishersService } from './publishers.service';
import { PublishersController } from './publishers.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Publisher, ServiceReport]),
    AuditLogModule,
    PushNotificationsModule,
  ],
  controllers: [PublishersController],
  providers: [PublishersService],
  exports: [PublishersService],
})
export class PublishersModule {}
