import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { PublishersService } from './publishers.service';
import { PublishersController } from './publishers.controller';
import { AuxiliaryPioneersModule } from '../auxiliary-pioneers/auxiliary-pioneers.module';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { UsersModule } from '../users/users.module';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Publisher,
      ServiceReport,
      Responsibility,
      ReportMonthClosure,
    ]),
    AuditLogModule,
    PushNotificationsModule,
    UsersModule,
    AuxiliaryPioneersModule,
    CongregationClockModule,
  ],
  controllers: [PublishersController],
  providers: [PublishersService, ResponsibilityGuard],
  exports: [PublishersService],
})
export class PublishersModule {}
