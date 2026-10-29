import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceLogEntry } from '../entities/service-log-entry.entity';
import { Publisher } from '../entities/publisher.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { AuxPioneerApplication } from '../entities/aux-pioneer-application.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { ServiceLogService } from './service-log.service';
import { ServiceLogController } from './service-log.controller';

@Module({
  imports: [
    CongregationClockModule,
    TypeOrmModule.forFeature([
      ServiceLogEntry,
      Publisher,
      PioneerSpell,
      AuxiliaryPioneer,
      AuxPioneerApplication,
      ServiceReport,
      ReportMonthClosure,
    ]),
  ],
  controllers: [ServiceLogController],
  providers: [ServiceLogService],
  exports: [ServiceLogService],
})
export class ServiceLogModule {}
