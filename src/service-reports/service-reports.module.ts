import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { ServiceReportsController } from './service-reports.controller';
import { ServiceReportsService } from './service-reports.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceReport, Publisher, ServiceGroup]),
    AuditLogModule,
  ],
  controllers: [ServiceReportsController],
  providers: [ServiceReportsService],
})
export class ServiceReportsModule {}
