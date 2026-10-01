import { Module } from '@nestjs/common';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnualReportController } from './annual-report.controller';
import { AnnualReportService } from './annual-report.service';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { ReportSnapshot } from '../entities/report-snapshot.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MeetingAttendanceModule } from '../meeting-attendance/meeting-attendance.module';
import { AnnualSentService } from './annual-sent.service';
import { Responsibility } from '../entities/responsibility.entity';
import { Congregation } from '../entities/congregation.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceReport,
      Publisher,
      AuditLog,
      ReportSnapshot,
      Responsibility,
      Congregation,
      ElderTask,
      ElderTaskCalendarLog,
    ]),
    CongregationClockModule,
    AuditLogModule,
    MeetingAttendanceModule,
  ],
  controllers: [AnnualReportController],
  providers: [AnnualReportService, AnnualSentService, ResponsibilityGuard],
  exports: [AnnualReportService, AnnualSentService],
})
export class AnnualReportModule {}
