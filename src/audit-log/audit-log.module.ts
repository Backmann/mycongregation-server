import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { JournalService } from './journal.service';
import { JournalController } from './journal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, Publisher, User])],
  controllers: [JournalController],
  providers: [AuditLogService, JournalService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
