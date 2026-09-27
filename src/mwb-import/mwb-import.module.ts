import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingAttendanceModule } from '../meeting-attendance/meeting-attendance.module';
import { Assignment } from '../entities/assignment.entity';
import { MwbImportController } from './mwb-import.controller';
import { MwbImportService } from './mwb-import.service';
import { CoVisitTemplateModule } from '../special-events/co-visit-template.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment]),
    MeetingAttendanceModule,
    CoVisitTemplateModule,
  ],
  controllers: [MwbImportController],
  providers: [MwbImportService],
  exports: [MwbImportService],
})
export class MwbImportModule {}
