import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/public.decorator';
import { sourceFingerprint } from './source-fingerprint';

/**
 * What the walkthrough needs to know before it trusts this server
 * (26 September): which source it is running, and whether the database has
 * every migration. Neither is automatic on a development machine — the
 * migrations are run by hand (`npm run migration:run`), and a watcher that
 * hit a compile error keeps the old process serving.
 *
 * Development only. Anywhere else the address does not exist.
 */
@Controller('health')
export class DevInfoController {
  private readonly dev: boolean;
  /** Taken once, at start: what THIS process was built from. */
  private readonly startedFrom: string | null;

  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.dev = config.get<string>('app.nodeEnv') === 'development';
    this.startedFrom = this.dev ? sourceFingerprint(process.cwd()) : null;
  }

  @Public()
  @Get('dev')
  async devInfo(): Promise<{
    sourceFingerprint: string | null;
    pendingMigrations: boolean;
  }> {
    if (!this.dev) throw new NotFoundException();
    return {
      sourceFingerprint: this.startedFrom,
      pendingMigrations: await this.dataSource.showMigrations(),
    };
  }
}
