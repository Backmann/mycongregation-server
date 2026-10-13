import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { WeekRulesModule } from '../common/week-rules.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProgrammeFreezeService } from './programme-freeze.service';

/**
 * The programme's freeze on its own, so that every writer of the programme
 * — the programme itself, the workbook import, the talk journal — can ask
 * it without importing one another.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Responsibility]),
    WeekRulesModule,
    CongregationClockModule,
    AuditLogModule,
  ],
  providers: [ProgrammeFreezeService],
  exports: [ProgrammeFreezeService],
})
export class ProgrammeFreezeModule {}
