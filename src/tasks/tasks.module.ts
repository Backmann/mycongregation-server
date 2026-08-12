import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElderTask } from '../entities/elder-task.entity';
import { EldersMeeting } from '../entities/elders-meeting.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { TaskAddresseesService } from './task-addressees.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ElderTask,
      EldersMeeting,
      Publisher,
      Responsibility,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskAddresseesService],
  exports: [TasksService, TaskAddresseesService],
})
export class TasksModule {}
