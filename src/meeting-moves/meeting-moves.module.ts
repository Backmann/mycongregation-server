import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { MeetingMove } from '../entities/meeting-move.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { MeetingMovesController } from './meeting-moves.controller';
import { MeetingMovesService } from './meeting-moves.service';

@Module({
  imports: [
    AuditLogModule,
    CongregationClockModule,
    TypeOrmModule.forFeature([
      MeetingMove,
      MeetingSettings,
      SpecialEvent,
      Responsibility,
      MeetingAttendance,
    ]),
  ],
  controllers: [MeetingMovesController],
  providers: [MeetingMovesService],
  exports: [MeetingMovesService],
})
export class MeetingMovesModule {}
