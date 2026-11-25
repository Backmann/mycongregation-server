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
    ]),
  ],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
