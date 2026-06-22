import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { VisitingSpeakersService } from './visiting-speakers.service';
import { VisitingSpeakersController } from './visiting-speakers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([VisitingSpeaker, Responsibility])],
  controllers: [VisitingSpeakersController],
  providers: [VisitingSpeakersService],
  exports: [VisitingSpeakersService],
})
export class VisitingSpeakersModule {}
