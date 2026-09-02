import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemorialService } from './memorial.service';
import { MemorialController } from './memorial.controller';
import { MemorialItem } from '../entities/memorial-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Duty } from '../entities/duty.entity';
import { Publisher } from '../entities/publisher.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MemorialItem, SpecialEvent, Duty, Publisher]),
    AuditLogModule,
    CongregationClockModule,
    NotificationsModule,
  ],
  controllers: [MemorialController],
  providers: [MemorialService],
  exports: [MemorialService],
})
export class MemorialModule {}
