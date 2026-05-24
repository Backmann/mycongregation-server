import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { AssignmentSectionGuard } from '../common/guards/assignment-section.guard';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Assignment, Responsibility])],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentSectionGuard],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
