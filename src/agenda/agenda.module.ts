import { Module } from '@nestjs/common';
import { AuxiliaryPioneersModule } from '../auxiliary-pioneers/auxiliary-pioneers.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { WeekRulesModule } from '../common/week-rules.module';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

@Module({
  imports: [WeekRulesModule, CongregationClockModule, AuxiliaryPioneersModule],
  controllers: [AgendaController],
  providers: [AgendaService],
  exports: [AgendaService],
})
export class AgendaModule {}
