import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { MwbImportController } from './mwb-import.controller';
import { MwbImportService } from './mwb-import.service';

@Module({
  imports: [TypeOrmModule.forFeature([Assignment])],
  controllers: [MwbImportController],
  providers: [MwbImportService],
  exports: [MwbImportService],
})
export class MwbImportModule {}
