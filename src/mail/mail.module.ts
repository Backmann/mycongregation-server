import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Global so that AuthModule (and future senders) can inject MailService
 * without touching their own imports.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
