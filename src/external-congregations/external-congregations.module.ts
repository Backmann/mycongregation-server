import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ExternalCongregationsService } from './external-congregations.service';
import { ExternalCongregationsController } from './external-congregations.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExternalCongregation, Responsibility]),
    AuditLogModule,
  ],
  controllers: [ExternalCongregationsController],
  providers: [ExternalCongregationsService],
  exports: [ExternalCongregationsService],
})
export class ExternalCongregationsModule {}
