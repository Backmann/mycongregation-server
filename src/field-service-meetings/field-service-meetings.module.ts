import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldServiceMeetingsController } from './field-service-meetings.controller';
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { FieldServiceMonthThemesController } from './field-service-month-themes.controller';
import { FieldServiceMonthThemesService } from './field-service-month-themes.service';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { FieldServiceMonthTheme } from '../entities/field-service-month-theme.entity';
import { Responsibility } from '../entities/responsibility.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FieldServiceMeeting,
      FieldServiceMonthTheme,
      Responsibility,
    ]),
  ],
  controllers: [
    FieldServiceMeetingsController,
    FieldServiceMonthThemesController,
  ],
  providers: [
    FieldServiceMeetingsService,
    FieldServiceMonthThemesService,
    ResponsibilityGuard,
  ],
})
export class FieldServiceMeetingsModule {}
