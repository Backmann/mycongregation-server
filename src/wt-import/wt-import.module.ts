import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { WtImportService } from './wt-import.service';
import { CoVisitTemplateModule } from '../special-events/co-visit-template.module';

@Module({
  imports: [TypeOrmModule.forFeature([Assignment]), CoVisitTemplateModule],
  providers: [WtImportService],
  exports: [WtImportService],
})
export class WtImportModule {}
