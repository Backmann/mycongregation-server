import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { ServiceReportsController } from './service-reports.controller';
import { ServiceReportsService } from './service-reports.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PublishersModule } from '../publishers/publishers.module';
import { AuxiliaryPioneersModule } from '../auxiliary-pioneers/auxiliary-pioneers.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceReport,
      Publisher,
      ServiceGroup,
      Responsibility,
      ReportMonthClosure,
      PioneerSpell,
    ]),
    AuditLogModule,
    PublishersModule,
    AuxiliaryPioneersModule,
    CongregationClockModule,
  ],
  controllers: [ServiceReportsController],
  providers: [ServiceReportsService],
  // The «what is waiting for me» door asks this service for the report
  // standing rather than working the deadline out a second time.
  exports: [ServiceReportsService],
})
export class ServiceReportsModule {}
