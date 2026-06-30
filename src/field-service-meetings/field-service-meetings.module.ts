import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldServiceMeetingsController } from './field-service-meetings.controller';
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { FieldServiceMonthThemesController } from './field-service-month-themes.controller';
import { FieldServiceMonthThemesService } from './field-service-month-themes.service';
import { FieldServiceTemplateController } from './field-service-template.controller';
import { FieldServiceTemplateService } from './field-service-template.service';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { FieldServiceMonthTheme } from '../entities/field-service-month-theme.entity';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { Responsibility } from '../entities/responsibility.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FieldServiceMeeting,
      FieldServiceMonthTheme,
      FieldServiceTemplateSlot,
      Responsibility,
    ]),
  ],
  controllers: [
    FieldServiceMeetingsController,
    FieldServiceMonthThemesController,
    FieldServiceTemplateController,
  ],
  providers: [
    FieldServiceMeetingsService,
    FieldServiceMonthThemesService,
    FieldServiceTemplateService,
    ResponsibilityGuard,
  ],
})
export class FieldServiceMeetingsModule {}
