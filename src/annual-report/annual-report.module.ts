import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnualReportController } from './annual-report.controller';
import { AnnualReportService } from './annual-report.service';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceReport, Publisher, Responsibility]),
  ],
  controllers: [AnnualReportController],
  providers: [AnnualReportService, ResponsibilityGuard],
  exports: [AnnualReportService],
})
export class AnnualReportModule {}
