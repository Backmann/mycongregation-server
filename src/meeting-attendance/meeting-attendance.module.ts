import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingAttendanceController } from './meeting-attendance.controller';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MeetingAttendance, Responsibility]),
    AuditLogModule,
  ],
  controllers: [MeetingAttendanceController],
  providers: [MeetingAttendanceService, ResponsibilityGuard],
  exports: [MeetingAttendanceService],
})
export class MeetingAttendanceModule {}
