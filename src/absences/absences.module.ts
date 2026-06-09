import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Absence } from '../entities/absence.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { AbsencesService } from './absences.service';
import { AbsencesController } from './absences.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Absence, Responsibility])],
  controllers: [AbsencesController],
  providers: [AbsencesService, ResponsibilityGuard],
  exports: [AbsencesService],
})
export class AbsencesModule {}
