import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceGroup } from '../entities/service-group.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { ServiceGroupsService } from './service-groups.service';
import { ServiceGroupsController } from './service-groups.controller';
import { PublishersModule } from '../publishers/publishers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceGroup,
      FieldServiceMeeting,
      FieldServiceTemplateSlot,
    ]),
    CongregationClockModule,
    PublishersModule,
    AuditLogModule,
  ],
  controllers: [ServiceGroupsController],
  providers: [ServiceGroupsService],
  exports: [ServiceGroupsService],
})
export class ServiceGroupsModule {}
