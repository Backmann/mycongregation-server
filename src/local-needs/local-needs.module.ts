import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocalNeedsTopic } from '../entities/local-needs-topic.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { LocalNeedsService } from './local-needs.service';
import { LocalNeedsController } from './local-needs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LocalNeedsTopic, Responsibility]),
    AuditLogModule,
  ],
  controllers: [LocalNeedsController],
  providers: [LocalNeedsService],
  exports: [LocalNeedsService],
})
export class LocalNeedsModule {}
