import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgendaSeen } from '../entities/agenda-seen.entity';
import { AuxiliaryPioneersModule } from '../auxiliary-pioneers/auxiliary-pioneers.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { WeekRulesModule } from '../common/week-rules.module';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { AgendaSeenService } from './agenda-seen.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgendaSeen]),
    WeekRulesModule,
    CongregationClockModule,
    AuxiliaryPioneersModule,
  ],
  controllers: [AgendaController],
  providers: [AgendaService, AgendaSeenService],
  exports: [AgendaService],
})
export class AgendaModule {}
