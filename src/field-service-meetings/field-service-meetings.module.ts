import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldServiceMeetingsController } from './field-service-meetings.controller';
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Responsibility } from '../entities/responsibility.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FieldServiceMeeting, Responsibility])],
  controllers: [FieldServiceMeetingsController],
  providers: [FieldServiceMeetingsService, ResponsibilityGuard],
})
export class FieldServiceMeetingsModule {}
