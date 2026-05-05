import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { WtImportService } from './wt-import.service';

@Module({
  imports: [TypeOrmModule.forFeature([Assignment])],
  providers: [WtImportService],
  exports: [WtImportService],
})
export class WtImportModule {}
