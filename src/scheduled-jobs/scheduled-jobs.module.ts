import { Module } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { AdminController } from './admin.controller';
import { PublishersModule } from '../publishers/publishers.module';

@Module({
  imports: [PublishersModule],
  controllers: [AdminController],
  providers: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
