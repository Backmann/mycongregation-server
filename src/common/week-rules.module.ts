import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { WeekRulesService } from './week-rules.service';

@Module({
  imports: [TypeOrmModule.forFeature([MeetingSettings, SpecialEvent])],
  providers: [WeekRulesService],
  exports: [WeekRulesService],
})
export class WeekRulesModule {}
