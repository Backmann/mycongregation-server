import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { PresenceService } from './presence.service';
import { PresenceInterceptor } from './presence.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [
    PresenceService,
    {
      provide: APP_INTERCEPTOR,
      useClass: PresenceInterceptor,
    },
  ],
  exports: [PresenceService],
})
export class PresenceModule {}
