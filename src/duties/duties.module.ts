import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DutiesController } from './duties.controller';
import { DutiesService } from './duties.service';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { Duty } from '../entities/duty.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { Congregation } from '../entities/congregation.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Duty,
      Assignment,
      Publisher,
      MeetingSettings,
      Responsibility,
      Congregation,
      SpecialEvent,
    ]),
  ],
  controllers: [DutiesController],
  providers: [DutiesService, ResponsibilityGuard],
  exports: [DutiesService],
})
export class DutiesModule {}
