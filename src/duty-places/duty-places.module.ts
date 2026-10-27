import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DutyPlace } from '../entities/duty-place.entity';
import { DutyPlacesService } from './duty-places.service';

@Module({
  imports: [TypeOrmModule.forFeature([DutyPlace])],
  providers: [DutyPlacesService],
  exports: [DutyPlacesService],
})
export class DutyPlacesModule {}
