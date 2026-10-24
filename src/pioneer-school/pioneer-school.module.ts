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
import { CongregationClockModule } from '../common/congregation-clock.module';
import { PioneerSchoolService } from './pioneer-school.service';
import { PioneerSchoolController } from './pioneer-school.controller';
import { SCHOOL_SYNC } from './school-sync';

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
    CongregationClockModule,
  ],
  controllers: [PioneerSchoolController],
  providers: [
    PioneerSchoolService,
    { provide: SCHOOL_SYNC, useExisting: PioneerSchoolService },
  ],
  exports: [PioneerSchoolService, SCHOOL_SYNC],
})
export class PioneerSchoolModule {}
