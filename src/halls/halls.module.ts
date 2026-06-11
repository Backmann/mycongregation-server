import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hall } from '../entities/hall.entity';
import { HallsService } from './halls.service';
import { HallsController } from './halls.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Hall])],
  controllers: [HallsController],
  providers: [HallsService],
  exports: [HallsService],
})
export class HallsModule {}
