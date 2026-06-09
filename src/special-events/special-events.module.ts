import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { SpecialEventsService } from './special-events.service';
import { SpecialEventsController } from './special-events.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [TypeOrmModule.forFeature([SpecialEvent, Responsibility])],
  controllers: [SpecialEventsController],
  providers: [SpecialEventsService, ResponsibilityGuard],
  exports: [SpecialEventsService],
})
export class SpecialEventsModule {}
