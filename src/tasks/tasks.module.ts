import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElderTask } from '../entities/elder-task.entity';
import { EldersMeeting } from '../entities/elders-meeting.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { TaskAddresseesService } from './task-addressees.service';
import { Congregation } from '../entities/congregation.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { CalendarTasksService } from './calendar-tasks.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { TaskRemindersService } from './task-reminders.service';
import { EldersMeetingItem } from '../entities/elders-meeting-item.entity';
import { AgendaItemsService } from './agenda-items.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CongregationClockModule } from '../common/congregation-clock.module';

@Module({
  imports: [
    CongregationClockModule,
    NotificationsModule,
    // The agenda writes to the journal now — and a service can only be
    // injected if its module is imported. Nothing caught this: the tests build
    // the service by hand, and the compiler sees only types. It showed itself
    // where such things always do, at the first start after deploying.
    AuditLogModule,
    TypeOrmModule.forFeature([
      ElderTask,
      EldersMeeting,
      Publisher,
      Responsibility,
      Congregation,
      ElderTaskCalendarLog,
      EldersMeetingItem,
    ]),
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    TaskAddresseesService,
    CalendarTasksService,
    TaskRemindersService,
    AgendaItemsService,
  ],
  exports: [
    TasksService,
    TaskAddresseesService,
    CalendarTasksService,
    TaskRemindersService,
    AgendaItemsService,
  ],
})
export class TasksModule {}
