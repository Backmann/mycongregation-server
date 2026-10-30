import { Module } from '@nestjs/common';
import { PrintDocsController } from './print-docs.controller';
import { PrintDocsService } from './print-docs.service';

@Module({
  controllers: [PrintDocsController],
  providers: [PrintDocsService],
})
export class PrintDocsModule {}
