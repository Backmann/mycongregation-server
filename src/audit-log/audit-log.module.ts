import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { AuditLogService } from './audit-log.service';
import { JournalService } from './journal.service';
import { JournalController } from './journal.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLog,
      Publisher,
      User,
      // Read-only, and only to answer "which one" for a journal entry.
      Assignment,
      Duty,
      CleaningAssignment,
      FieldServiceMeeting,
    ]),
  ],
  controllers: [JournalController],
  providers: [AuditLogService, JournalService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
