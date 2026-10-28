import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../../entities/assignment.entity';
import { LocalNeedsTopic } from '../../entities/local-needs-topic.entity';
import { AssignmentsModule } from '../../assignments/assignments.module';
import { LocalNeedsModule } from '../local-needs.module';
import { LocalNeedsPlacementService } from './local-needs-placement.service';
import { LocalNeedsPlacementController } from './local-needs-placement.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LocalNeedsTopic, Assignment]),
    AssignmentsModule,
    LocalNeedsModule,
  ],
  controllers: [LocalNeedsPlacementController],
  providers: [LocalNeedsPlacementService],
})
export class LocalNeedsPlacementModule {}
