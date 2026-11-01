import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { PublisherMerge } from '../entities/publisher-merge.entity';
import { CardMergeService } from './card-merge.service';
import { CardMergeController } from './card-merge.controller';
import { PublishersService } from './publishers.service';
import { PublishersController } from './publishers.controller';
import { AuxiliaryPioneersModule } from '../auxiliary-pioneers/auxiliary-pioneers.module';
import { PioneerSpellsModule } from '../pioneer-spells/pioneer-spells.module';
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
      PublisherMerge,
    ]),
    AuditLogModule,
    PushNotificationsModule,
    UsersModule,
    AuxiliaryPioneersModule,
    PioneerSpellsModule,
    CongregationClockModule,
  ],
  controllers: [CardMergeController, PublishersController],
  providers: [PublishersService, CardMergeService, ResponsibilityGuard],
  exports: [PublishersService, CardMergeService],
})
export class PublishersModule {}
