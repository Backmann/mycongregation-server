import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Assignment } from '../entities/assignment.entity';
import { SpecialEventsService } from './special-events.service';
import { SpecialEventsController } from './special-events.controller';
import { CoVisitTemplateService } from './co-visit-template.service';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([SpecialEvent, Responsibility, Assignment]),
  ],
  controllers: [SpecialEventsController],
  providers: [
    SpecialEventsService,
    CoVisitTemplateService,
    ResponsibilityGuard,
  ],
  exports: [SpecialEventsService],
})
export class SpecialEventsModule {}
