import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceGroup } from '../entities/service-group.entity';
import { ServiceGroupsService } from './service-groups.service';
import { ServiceGroupsController } from './service-groups.controller';
import { PublishersModule } from '../publishers/publishers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceGroup]),
    PublishersModule,
    AuditLogModule,
  ],
  controllers: [ServiceGroupsController],
  providers: [ServiceGroupsService],
  exports: [ServiceGroupsService],
})
export class ServiceGroupsModule {}
