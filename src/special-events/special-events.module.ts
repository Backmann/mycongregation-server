import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Assignment } from '../entities/assignment.entity';
import { SpecialEventsService } from './special-events.service';
import { SpecialEventsController } from './special-events.controller';
import { CoVisitTemplateModule } from './co-visit-template.module';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    CongregationClockModule,
    TypeOrmModule.forFeature([SpecialEvent, Responsibility, Assignment]),
    AuditLogModule,
    CoVisitTemplateModule,
  ],
  controllers: [SpecialEventsController],
  providers: [SpecialEventsService, ResponsibilityGuard],
  exports: [SpecialEventsService],
})
export class SpecialEventsModule {}
