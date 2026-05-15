import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { User } from '../entities/user.entity';
import { ActivityFeedController } from './activity-feed.controller';
import { ActivityFeedService } from './activity-feed.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, Publisher, ServiceReport, User])],
  controllers: [ActivityFeedController],
  providers: [ActivityFeedService],
})
export class ActivityFeedModule {}
