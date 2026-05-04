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

@Module({
  imports: [
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
        entities: [join(__dirname, '**', '*.entity.{ts,js}')],
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
        namingStrategy: new SnakeNamingStrategy(),
        synchronize: false,
        autoLoadEntities: true,
        logging: config.get<string>('app.nodeEnv') === 'development',
      }),
    }),
    UsersModule,
    AuthModule,
    PublishersModule,
    FamiliesModule,
    ServiceGroupsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
