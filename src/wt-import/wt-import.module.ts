import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment } from '../entities/assignment.entity';
import { WtImportService } from './wt-import.service';
import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';
import { CoVisitTemplateModule } from '../special-events/co-visit-template.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment]),
    CoVisitTemplateModule,
    TalkExchangeModule,
  ],
  providers: [WtImportService],
  exports: [WtImportService],
})
export class WtImportModule {}
