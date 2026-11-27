import { Global, Module } from '@nestjs/common';
import { ServerErrors } from './server-errors';
import { ServerErrorsController } from './server-errors.controller';

@Global()
@Module({
  controllers: [ServerErrorsController],
  providers: [ServerErrors],
  exports: [ServerErrors],
})
export class ServerErrorsModule {}
