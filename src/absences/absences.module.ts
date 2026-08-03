import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Absence } from '../entities/absence.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { AbsencesService } from './absences.service';
import { AbsencesController } from './absences.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Absence, Responsibility, Publisher]),
    AuditLogModule,
    CongregationClockModule,
  ],
  controllers: [AbsencesController],
  providers: [AbsencesService, ResponsibilityGuard],
  exports: [AbsencesService],
})
export class AbsencesModule {}
