import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoVisitFolder } from '../entities/co-visit-folder.entity';
import { CoVisitFolderMark } from '../entities/co-visit-folder-mark.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Congregation } from '../entities/congregation.entity';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceReportsModule } from '../service-reports/service-reports.module';
import { CoVisitFolderService } from './co-visit-folder.service';
import { CoVisitFolderController } from './co-visit-folder.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoVisitFolder,
      CoVisitFolderMark,
      SpecialEvent,
      Publisher,
      Responsibility,
      ServiceGroup,
      Congregation,
    ]),
    CongregationClockModule,
    NotificationsModule,
    ServiceReportsModule,
  ],
  providers: [CoVisitFolderService],
  controllers: [CoVisitFolderController],
  exports: [CoVisitFolderService],
})
export class CoVisitFolderModule {}
