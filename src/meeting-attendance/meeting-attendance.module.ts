import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingAttendanceController } from './meeting-attendance.controller';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Publisher } from '../entities/publisher.entity';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MeetingAttendance,
      Responsibility,
      MeetingSettings,
      SpecialEvent,
      Publisher,
    ]),
    AuditLogModule,
  ],
  controllers: [MeetingAttendanceController],
  providers: [MeetingAttendanceService, ResponsibilityGuard],
  exports: [MeetingAttendanceService],
})
export class MeetingAttendanceModule {}
