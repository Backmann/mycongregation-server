import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserOrIpThrottlerGuard } from './common/guards/throttler.guard';
import { RequestContextInterceptor } from './common/request-context.interceptor';
import { BackupsModule } from './backups/backups.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { join } from 'path';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PresenceModule } from './presence/presence.module';
import { PublishersModule } from './publishers/publishers.module';
import { ServiceGroupsModule } from './service-groups/service-groups.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { MwbImportModule } from './mwb-import/mwb-import.module';
import { WtImportModule } from './wt-import/wt-import.module';
import { ScheduleImportModule } from './schedule-import/schedule-import.module';
import { PublicTalksModule } from './public-talks/public-talks.module';
import { SongsModule } from './songs/songs.module';
import { ServiceReportsModule } from './service-reports/service-reports.module';
import { CryptoModule } from './crypto/crypto.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduledJobsModule } from './scheduled-jobs/scheduled-jobs.module';
import { ReportRemindersModule } from './report-reminders/report-reminders.module';
import { SpecialEventsModule } from './special-events/special-events.module';
import { AbsencesModule } from './absences/absences.module';
import { LocalNeedsModule } from './local-needs/local-needs.module';
import { ExternalCongregationsModule } from './external-congregations/external-congregations.module';
import { VisitingSpeakersModule } from './visiting-speakers/visiting-speakers.module';
import { TalkExchangeModule } from './talk-exchange/talk-exchange.module';
import { HallsModule } from './halls/halls.module';
import { MailModule } from './mail/mail.module';
import { MeModule } from './me/me.module';
import { PushNotificationsModule } from './push-notifications/push-notifications.module';
import { WebPushModule } from './web-push/web-push.module';
import { ActivityFeedModule } from './activity-feed/activity-feed.module';
import { ResponsibilitiesModule } from './responsibilities/responsibilities.module';
import { MeetingSettingsModule } from './meeting-settings/meeting-settings.module';
import { CircuitOverseerModule } from './circuit-overseer/circuit-overseer.module';
import { DutiesModule } from './duties/duties.module';
import { MeetingAttendanceModule } from './meeting-attendance/meeting-attendance.module';
import { AnnualReportModule } from './annual-report/annual-report.module';
import { FieldServiceMeetingsModule } from './field-service-meetings/field-service-meetings.module';
import { CoVisitItemsModule } from './co-visit-items/co-visit-items.module';
import { AuxiliaryPioneersModule } from './auxiliary-pioneers/auxiliary-pioneers.module';
import { CleaningModule } from './cleaning/cleaning.module';
import { CartLocationsModule } from './cart-locations/cart-locations.module';
import { CartWeeksModule } from './cart-weeks/cart-weeks.module';

import { PublisherActivityModule } from './publisher-activity/publisher-activity.module';

@Module({
  imports: [
    ActivityFeedModule,
    PublisherActivityModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.database'),
        // TLS on production (Phase L Phase 4B). When POSTGRES_SSL=true is set
        // in the runtime .env, TypeORM negotiates TLS with the server.
        // rejectUnauthorized: false because the cert is self-signed on the
        // internal docker network — the password still authenticates.
        ssl:
          process.env.POSTGRES_SSL === 'true'
            ? { rejectUnauthorized: false }
            : false,
        entities: [join(__dirname, '**', '*.entity.{ts,js}')],
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        namingStrategy: new SnakeNamingStrategy(),
        synchronize: false,
        autoLoadEntities: true,
        logging: config.get<string>('app.nodeEnv') === 'development',
      }),
    }),
    CryptoModule,
    BackupsModule,
    UsersModule,
    AuthModule,
    PresenceModule,
    PublishersModule,
    ServiceGroupsModule,
    AssignmentsModule,
    MwbImportModule,
    WtImportModule,
    ScheduleImportModule,
    PublicTalksModule,
    SongsModule,
    ServiceReportsModule,
    ScheduleModule.forRoot(),
    ScheduledJobsModule,
    ReportRemindersModule,
    SpecialEventsModule,
    AbsencesModule,
    LocalNeedsModule,
    ExternalCongregationsModule,
    VisitingSpeakersModule,
    TalkExchangeModule,
    HallsModule,
    MailModule,
    MeModule,
    PushNotificationsModule,
    WebPushModule,
    ResponsibilitiesModule,
    MeetingSettingsModule,
    CircuitOverseerModule,
    DutiesModule,
    MeetingAttendanceModule,
    AnnualReportModule,
    FieldServiceMeetingsModule,
    CoVisitItemsModule,
    AuxiliaryPioneersModule,
    CleaningModule,
    CartLocationsModule,
    CartWeeksModule,
    // A broad net against hammering: nothing but login and password reset had
    // any limit before this. Two windows so that a short burst — opening a
    // screen that fires a dozen queries at once — stays comfortable, while a
    // script running flat out is stopped within the minute.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 10_000, limit: 60 },
      { name: 'long', ttl: 60_000, limit: 300 },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: UserOrIpThrottlerGuard,
    },
    {
      // Runs after authentication, so request.user is already there. It makes
      // the acting person available to the journal without every service
      // having to be handed one.
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule {}
