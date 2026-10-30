import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PioneerMeeting } from '../entities/pioneer-meeting.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { Publisher } from '../entities/publisher.entity';
import { Absence } from '../entities/absence.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Congregation } from '../entities/congregation.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PioneerMeetingsService } from './pioneer-meetings.service';
import { PioneerMeetingsController } from './pioneer-meetings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PioneerMeeting,
      PioneerSpell,
      Publisher,
      Absence,
      SpecialEvent,
      Responsibility,
      ElderTask,
      ElderTaskCalendarLog,
      Congregation,
    ]),
    CongregationClockModule,
    NotificationsModule,
    AuditLogModule,
  ],
  providers: [PioneerMeetingsService],
  controllers: [PioneerMeetingsController],
  exports: [PioneerMeetingsService],
})
export class PioneerMeetingsModule {}
