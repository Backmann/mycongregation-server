import { AuditLogModule } from '../audit-log/audit-log.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingAttendanceModule } from '../meeting-attendance/meeting-attendance.module';
import { Assignment } from '../entities/assignment.entity';
import { MwbImportController } from './mwb-import.controller';
import { MwbImportService } from './mwb-import.service';
import { CoVisitTemplateModule } from '../special-events/co-visit-template.module';
import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';
import { ProgrammeFreezeModule } from '../assignments/programme-freeze.module';
import { WeekRulesModule } from '../common/week-rules.module';
import { Congregation } from '../entities/congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ProgrammeFilesService } from './programme-files.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, Congregation, Responsibility]),
    AuditLogModule,
    MeetingAttendanceModule,
    CoVisitTemplateModule,
    TalkExchangeModule,
    ProgrammeFreezeModule,
    WeekRulesModule,
  ],
  controllers: [MwbImportController],
  providers: [MwbImportService, ProgrammeFilesService],
  exports: [MwbImportService],
})
export class MwbImportModule {}
