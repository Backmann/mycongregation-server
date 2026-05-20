import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { PublisherActivityService } from './publisher-activity.service';
import { PublisherActivityController } from './publisher-activity.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Assignment, Duty])],
  controllers: [PublisherActivityController],
  providers: [PublisherActivityService],
})
export class PublisherActivityModule {}
