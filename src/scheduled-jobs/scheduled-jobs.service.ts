import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PublishersService } from '../publishers/publishers.service';

@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(private readonly publishersService: PublishersService) {}

  /**
   * Nightly job — recompute every active publisher's status from the last
   * 6 months of reports. Skips publishers with a sticky manual override.
   *
   * Runs at 03:00 UTC daily. NestJS Schedule prevents overlapping ticks
   * automatically (if a previous run is still going, the next tick is
   * deferred), so no extra lock is needed for the single-container deploy.
   */
  @Cron('0 3 * * *', {
    name: 'status-recompute-nightly',
    timeZone: 'UTC',
  })
  async handleNightlyStatusRecompute(): Promise<void> {
    this.logger.log('[StatusRecompute] starting nightly run...');
    try {
      const summary = await this.publishersService.recomputeAllStatuses();
      this.logger.log(
        `[StatusRecompute] done — processed=${summary.processed} ` +
          `updated=${summary.updated} unchanged=${summary.unchanged} ` +
          `skipped(override)=${summary.skipped} errors=${summary.errors} ` +
          `tookMs=${summary.durationMs}`,
      );
    } catch (err: any) {
      this.logger.error(
        '[StatusRecompute] nightly run failed',
        err?.stack ?? err?.message ?? String(err),
      );
    }
  }
}
