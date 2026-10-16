import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConductLive } from '../entities/conduct-live.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Duty } from '../entities/duty.entity';
import { ConductLiveController } from './conduct-live.controller';
import { ConductLiveService } from './conduct-live.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConductLive, Assignment, Publisher, Duty]),
  ],
  controllers: [ConductLiveController],
  providers: [ConductLiveService],
  exports: [ConductLiveService],
})
export class ConductLiveModule {}
