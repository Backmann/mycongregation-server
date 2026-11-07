import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgendaModule } from '../agenda/agenda.module';
import { CongregationClockModule } from '../common/congregation-clock.module';
import { CalendarFeed } from '../entities/calendar-feed.entity';
import { Congregation } from '../entities/congregation.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import {
  CalendarFeedController,
  CalendarFeedSettingsController,
} from './calendar-feed.controller';
import { CalendarFeedService } from './calendar-feed.service';

@Module({
  imports: [
    AgendaModule,
    CongregationClockModule,
    TypeOrmModule.forFeature([CalendarFeed, User, Publisher, Congregation]),
  ],
  controllers: [CalendarFeedSettingsController, CalendarFeedController],
  providers: [CalendarFeedService],
  exports: [CalendarFeedService],
})
export class CalendarFeedModule {}
