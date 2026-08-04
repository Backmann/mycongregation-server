import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PioneerSchool } from '../entities/pioneer-school.entity';
import { PioneerSchoolDay } from '../entities/pioneer-school-day.entity';
import { PioneerSchoolDuty } from '../entities/pioneer-school-duty.entity';
import { PioneerSchoolHelper } from '../entities/pioneer-school-helper.entity';
import { Absence } from '../entities/absence.entity';
import { MeetingAttendanceModule } from '../meeting-attendance/meeting-attendance.module';
import { Duty } from '../entities/duty.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PioneerSchoolService } from './pioneer-school.service';
import { PioneerSchoolController } from './pioneer-school.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PioneerSchool,
      PioneerSchoolDay,
      PioneerSchoolDuty,
      PioneerSchoolHelper,
      Absence,
      Duty,
    ]),
    AuditLogModule,
    MeetingAttendanceModule,
  ],
  controllers: [PioneerSchoolController],
  providers: [PioneerSchoolService],
  exports: [PioneerSchoolService],
})
export class PioneerSchoolModule {}
