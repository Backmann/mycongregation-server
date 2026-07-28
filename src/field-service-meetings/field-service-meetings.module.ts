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
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { ServiceOverseerService } from './service-overseer.service';
import { ServiceOverseerController } from './service-overseer.controller';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FieldServiceMeeting,
      FieldServiceMonthTheme,
      FieldServiceTemplateSlot,
      Responsibility,
      Publisher,
      ServiceGroup,
    ]),
    PushNotificationsModule,
    NotificationsModule,
    AuditLogModule,
  ],
  controllers: [
    ServiceOverseerController,
    FieldServiceMeetingsController,
    FieldServiceMonthThemesController,
    FieldServiceTemplateController,
  ],
  providers: [
    FieldServiceMeetingsService,
    FieldServiceMonthThemesService,
    FieldServiceTemplateService,
    ServiceOverseerService,
    ResponsibilityGuard,
  ],
})
export class FieldServiceMeetingsModule {}
