import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ExternalCongregationsService } from './external-congregations.service';
import { ExternalCongregationsController } from './external-congregations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExternalCongregation, Responsibility])],
  controllers: [ExternalCongregationsController],
  providers: [ExternalCongregationsService],
  exports: [ExternalCongregationsService],
})
export class ExternalCongregationsModule {}
