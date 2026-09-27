import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { CoVisitTemplateService } from './co-visit-template.service';

/**
 * The circuit-visit template on its own, so the places that create a week's
 * meetings — the workbook import, the Watchtower import, a week made by hand —
 * can offer it without pulling in the whole events module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, SpecialEvent]),
    CongregationClockModule,
  ],
  providers: [CoVisitTemplateService],
  exports: [CoVisitTemplateService],
})
export class CoVisitTemplateModule {}
