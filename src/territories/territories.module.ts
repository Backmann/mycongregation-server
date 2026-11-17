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
import { AuditLog } from '../entities/audit-log.entity';
import { TerritoryHistoryService } from './territory-history.service';
import {
  TerritoriesController,
  TerritoryLinksController,
  TerritoryPartsController,
} from './territories.controller';
import { TerritoryLinksService } from './territory-links.service';
import { TerritoryNoCallsService } from './territory-no-calls.service';
import { TerritoryRemindersService } from './territory-reminders.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { TerritoriesService } from './territories.service';
import { TerritoryAccessService } from './territory-access.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';
import { TerritoryOutlineService } from './territory-outline.service';
import { TerritoryReshapeService } from './territory-reshape.service';

import { TerritoryBusiness } from '../entities/territory-business.entity';
import { TerritoryBusinessVisit } from '../entities/territory-business-visit.entity';
import { TerritoryBusinessesService } from './territory-businesses.service';
import { TerritorySplit } from '../entities/territory-split.entity';
import { TerritoryStreetMark } from '../entities/territory-street-mark.entity';
import { TerritorySplitsService } from './territory-splits.service';
import { HomesSurveyService } from './homes-survey.service';
import { HomeMarksService } from './home-marks.service';
import { TerritoryRecutController } from './territory-recut.controller';
import { TerritoryRecutService } from './territory-recut.service';
import { TerritoryRecutApplyService } from './territory-recut-apply.service';
import {
  TerritoryRecut,
  TerritoryRecutProposal,
  TerritoryRecutRemark,
} from '../entities/territory-recut.entity';

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
      TerritoryBusiness,
      TerritoryBusinessVisit,
      TerritorySplit,
      TerritoryStreetMark,
      TerritoryRecut,
      TerritoryRecutProposal,
      TerritoryRecutRemark,
      AuditLog,
    ]),
    AuditLogModule,
    NotificationsModule,
  ],
  controllers: [
    TerritoriesController,
    TerritoryLinksController,
    TerritoryPartsController,
    TerritoryRecutController,
  ],
  providers: [
    TerritoriesService,
    TerritoryHistoryService,
    TerritoryAccessService,
    TerritoryAssignmentsService,
    TerritoryLinksService,
    TerritoryNoCallsService,
    TerritoryOutlineService,
    TerritoryReshapeService,
    TerritoryRemindersService,
    TerritoryBusinessesService,
    TerritorySplitsService,
    HomesSurveyService,
    HomeMarksService,
    TerritoryRecutService,
    TerritoryRecutApplyService,
  ],
  exports: [
    TerritoryAccessService,
    TerritoryNoCallsService,
    TerritoryAssignmentsService,
    TerritoryRemindersService,
  ],
})
export class TerritoriesModule {}
