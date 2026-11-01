import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { Publisher } from '../entities/publisher.entity';
import { PublisherActivityService } from './publisher-activity.service';
import { PublisherActivityController } from './publisher-activity.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Assignment, Duty, Publisher])],
  controllers: [PublisherActivityController],
  providers: [PublisherActivityService],
})
export class PublisherActivityModule {}
