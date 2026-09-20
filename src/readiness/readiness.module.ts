import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { WeekRulesModule } from '../common/week-rules.module';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ReadinessService } from './readiness.service';
import { ReadinessController } from './readiness.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, Duty, Responsibility]),
    WeekRulesModule,
  ],
  controllers: [ReadinessController],
  providers: [ReadinessService, ResponsibilityGuard],
  exports: [ReadinessService],
})
export class ReadinessModule {}
