import { Module } from '@nestjs/common';
import { MwbImportModule } from '../mwb-import/mwb-import.module';
import { WtImportModule } from '../wt-import/wt-import.module';
import { ScheduleImportController } from './schedule-import.controller';

@Module({
  imports: [MwbImportModule, WtImportModule],
  controllers: [ScheduleImportController],
})
export class ScheduleImportModule {}
