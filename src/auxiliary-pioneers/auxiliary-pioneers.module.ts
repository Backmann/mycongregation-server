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
    ]),
    AuditLogModule,
  ],
  controllers: [AuxiliaryPioneersController],
  providers: [AuxiliaryPioneersService],
  exports: [AuxiliaryPioneersService],
})
export class AuxiliaryPioneersModule {}
