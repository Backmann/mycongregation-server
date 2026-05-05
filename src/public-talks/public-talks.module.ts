import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicTalk } from '../entities/public-talk.entity';
import { Assignment } from '../entities/assignment.entity';
import { PublicTalksController } from './public-talks.controller';
import { PublicTalksService } from './public-talks.service';

@Module({
  imports: [TypeOrmModule.forFeature([PublicTalk, Assignment])],
  controllers: [PublicTalksController],
  providers: [PublicTalksService],
  exports: [PublicTalksService],
})
export class PublicTalksModule {}
