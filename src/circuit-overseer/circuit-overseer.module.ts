import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CircuitOverseer } from '../entities/circuit-overseer.entity';
import { CircuitOverseerService } from './circuit-overseer.service';
import { CircuitOverseerController } from './circuit-overseer.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CircuitOverseer])],
  controllers: [CircuitOverseerController],
  providers: [CircuitOverseerService],
  exports: [CircuitOverseerService],
})
export class CircuitOverseerModule {}
