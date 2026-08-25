import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { Congregation } from '../entities/congregation.entity';
import { MeetingSettingsService } from './meeting-settings.service';
import { MeetingSettingsController } from './meeting-settings.controller';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    CongregationClockModule,
    TypeOrmModule.forFeature([MeetingSettings, Congregation]),
    AuditLogModule,
  ],
  controllers: [MeetingSettingsController],
  providers: [MeetingSettingsService],
  exports: [MeetingSettingsService],
})
export class MeetingSettingsModule {}
