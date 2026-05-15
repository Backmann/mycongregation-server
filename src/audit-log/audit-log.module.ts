import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, Publisher])],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
