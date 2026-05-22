import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { join } from 'path';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PublishersModule } from './publishers/publishers.module';
import { FamiliesModule } from './families/families.module';
import { ServiceGroupsModule } from './service-groups/service-groups.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { MwbImportModule } from './mwb-import/mwb-import.module';
import { WtImportModule } from './wt-import/wt-import.module';
import { ScheduleImportModule } from './schedule-import/schedule-import.module';
import { PublicTalksModule } from './public-talks/public-talks.module';
import { ServiceReportsModule } from './service-reports/service-reports.module';
import { CryptoModule } from './crypto/crypto.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduledJobsModule } from './scheduled-jobs/scheduled-jobs.module';
import { PushNotificationsModule } from './push-notifications/push-notifications.module';
import { WebPushModule } from './web-push/web-push.module';
import { ActivityFeedModule } from './activity-feed/activity-feed.module';
import { ResponsibilitiesModule } from './responsibilities/responsibilities.module';
import { MeetingSettingsModule } from './meeting-settings/meeting-settings.module';
import { DutiesModule } from './duties/duties.module';
import { FieldServiceMeetingsModule } from './field-service-meetings/field-service-meetings.module';
import { CleaningModule } from './cleaning/cleaning.module';
import { CartShiftsModule } from './cart-shifts/cart-shifts.module';

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
    UsersModule,
    AuthModule,
    PublishersModule,
    FamiliesModule,
    ServiceGroupsModule,
    AssignmentsModule,
    MwbImportModule,
    WtImportModule,
    ScheduleImportModule,
    PublicTalksModule,
    ServiceReportsModule,
    ScheduleModule.forRoot(),
    ScheduledJobsModule,
    PushNotificationsModule,
    WebPushModule,
    ResponsibilitiesModule,
    MeetingSettingsModule,
    DutiesModule,
    FieldServiceMeetingsModule,
    CleaningModule,
    CartShiftsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
