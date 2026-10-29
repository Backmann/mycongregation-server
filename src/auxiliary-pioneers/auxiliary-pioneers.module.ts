import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuxiliaryPioneersController } from './auxiliary-pioneers.controller';
import { AuxiliaryPioneersService } from './auxiliary-pioneers.service';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import {
  AuxPioneerApplication,
  AuxPioneerApplicationSeat,
} from '../entities/aux-pioneer-application.entity';
import { Absence } from '../entities/absence.entity';
import { Congregation } from '../entities/congregation.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuxApplicationsService } from './aux-applications.service';
import { AuxApplicationsController } from './aux-applications.controller';

@Module({
  imports: [
    CongregationClockModule,
    TypeOrmModule.forFeature([
      AuxiliaryPioneer,
      Publisher,
      Responsibility,
      SpecialEvent,
      ReportMonthClosure,
      PioneerSpell,
      AuxPioneerApplication,
      AuxPioneerApplicationSeat,
      Absence,
      Congregation,
    ]),
    NotificationsModule,
    AuditLogModule,
  ],
  controllers: [AuxiliaryPioneersController, AuxApplicationsController],
  providers: [AuxiliaryPioneersService, AuxApplicationsService],
  exports: [AuxiliaryPioneersService, AuxApplicationsService],
})
export class AuxiliaryPioneersModule {}
