import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PublishersService } from '../publishers/publishers.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(
    private readonly publishersService: PublishersService,
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

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

  /**
   * Cron — every 30 minutes, fetch Expo push receipts for tickets sent at
   * least 15 minutes ago, update push_receipts.status, and clean up
   * push_tokens whose Expo receipt is DeviceNotRegistered.
   *
   * Runs at :00 and :30 of every hour, UTC. NestJS Schedule prevents
   * overlapping ticks automatically.
   */
  @Cron('*/30 * * * *', {
    name: 'push-receipt-check',
    timeZone: 'UTC',
  })
  async handleReceiptCheck(): Promise<void> {
    this.logger.log('[PushReceipts] starting receipt-check run...');
    const start = Date.now();
    try {
      const summary = await this.pushNotificationsService.checkReceipts();
      const tookMs = Date.now() - start;
      this.logger.log(
        `[PushReceipts] done — checked=${summary.checked} ok=${summary.ok} ` +
          `errors=${summary.errors} tokensDeleted=${summary.tokensDeleted} ` +
          `tookMs=${tookMs}`,
      );
    } catch (err: any) {
      this.logger.error(
        '[PushReceipts] receipt-check run failed',
        err?.stack ?? err?.message ?? String(err),
      );
    }
  }

  /**
   * Cron — daily cleanup of push_receipts older than 7 days. Runs at
   * 03:30 UTC, just after the nightly status recompute, to keep the table
   * small. Expo only retains receipt data for ~24h anyway, so older
   * 'pending' rows are effectively orphans.
   */
  @Cron('30 3 * * *', {
    name: 'push-receipt-cleanup',
    timeZone: 'UTC',
  })
  async handleReceiptCleanup(): Promise<void> {
    this.logger.log('[PushReceiptsCleanup] starting daily cleanup...');
    const start = Date.now();
    try {
      const deleted = await this.pushNotificationsService.cleanupOldReceipts();
      const tookMs = Date.now() - start;
      this.logger.log(
        `[PushReceiptsCleanup] done — deleted=${deleted} tookMs=${tookMs}`,
      );
    } catch (err: any) {
      this.logger.error(
        '[PushReceiptsCleanup] daily cleanup failed',
        err?.stack ?? err?.message ?? String(err),
      );
    }
  }
}
