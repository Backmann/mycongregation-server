import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Territory } from '../entities/territory.entity';
import { TerritoryShape } from '../entities/territory-shape.entity';
import { TerritoryBoundary } from '../entities/territory-boundary.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Congregation } from '../entities/congregation.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { AuditLogModule } from '../audit-log/audit-log.module';
import {
  TerritoriesController,
  TerritoryLinksController,
} from './territories.controller';
import { TerritoryLinksService } from './territory-links.service';
import { TerritoryRemindersService } from './territory-reminders.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { TerritoriesService } from './territories.service';
import { TerritoryAccessService } from './territory-access.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Territory,
      TerritoryShape,
      TerritoryBoundary,
      TerritoryAssignment,
      TerritoryNoCall,
      TerritorySettings,
      Responsibility,
      Publisher,
      ServiceGroup,
      Congregation,
      FieldServiceMeeting,
    ]),
    AuditLogModule,
    NotificationsModule,
  ],
  controllers: [TerritoriesController, TerritoryLinksController],
  providers: [
    TerritoriesService,
    TerritoryAccessService,
    TerritoryAssignmentsService,
    TerritoryLinksService,
    TerritoryRemindersService,
  ],
  exports: [
    TerritoryAccessService,
    TerritoryAssignmentsService,
    TerritoryRemindersService,
  ],
})
export class TerritoriesModule {}
