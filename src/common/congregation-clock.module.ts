import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Congregation } from '../entities/congregation.entity';
import { CongregationClock } from './congregation-clock.service';

@Module({
  imports: [TypeOrmModule.forFeature([Congregation])],
  providers: [CongregationClock],
  exports: [CongregationClock],
})
export class CongregationClockModule {}
