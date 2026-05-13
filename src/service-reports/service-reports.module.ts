import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReportsController } from './service-reports.controller';
import { ServiceReportsService } from './service-reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceReport, Publisher])],
  controllers: [ServiceReportsController],
  providers: [ServiceReportsService],
})
export class ServiceReportsModule {}
