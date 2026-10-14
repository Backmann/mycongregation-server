import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConductRun } from '../entities/conduct-run.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { ConductRunsController } from './conduct-runs.controller';
import { ConductRunsService } from './conduct-runs.service';

@Module({
  imports: [TypeOrmModule.forFeature([ConductRun, Assignment, Publisher])],
  controllers: [ConductRunsController],
  providers: [ConductRunsService],
  exports: [ConductRunsService],
})
export class ConductRunsModule {}
