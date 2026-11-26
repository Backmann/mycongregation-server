import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingAnnouncement } from '../entities/meeting-announcement.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { WeekRulesModule } from '../common/week-rules.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementSuggestionsService } from './announcement-suggestions.service';
import { AnnouncementSuggestionsController } from './announcement-suggestions.controller';
import { AnnouncementDismissal } from '../entities/announcement-dismissal.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { Congregation } from '../entities/congregation.entity';

@Module({
  imports: [
    WeekRulesModule,
    CongregationClockModule,
    AuditLogModule,
    TypeOrmModule.forFeature([
      MeetingAnnouncement,
      Responsibility,
      Assignment,
      Publisher,
      AnnouncementDismissal,
      SpecialEvent,
      FieldServiceMeeting,
      ElderTask,
      Congregation,
    ]),
  ],
  // Suggestions first: their fixed paths are matched before «:id/…».
  controllers: [AnnouncementSuggestionsController, AnnouncementsController],
  providers: [AnnouncementsService, AnnouncementSuggestionsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
