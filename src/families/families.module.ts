import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Family } from '../entities/family.entity';
import { FamiliesService } from './families.service';
import { FamiliesController } from './families.controller';
import { PublishersModule } from '../publishers/publishers.module';

@Module({
  imports: [TypeOrmModule.forFeature([Family]), PublishersModule],
  controllers: [FamiliesController],
  providers: [FamiliesService],
  exports: [FamiliesService],
})
export class FamiliesModule {}
