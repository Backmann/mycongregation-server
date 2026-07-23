import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hall } from '../entities/hall.entity';
import { HallsService } from './halls.service';
import { HallsController } from './halls.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Hall]), AuditLogModule],
  controllers: [HallsController],
  providers: [HallsService],
  exports: [HallsService],
})
export class HallsModule {}
