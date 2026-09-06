import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { RefreshSession } from '../entities/refresh-session.entity';
// The invitation letter names the congregation it comes from: a letter from an
// unknown domain asking somebody to set a password is indistinguishable from a
// trick unless it says whose it is.
import { Congregation } from '../entities/congregation.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Publisher, RefreshSession, Congregation]),
    AuditLogModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
