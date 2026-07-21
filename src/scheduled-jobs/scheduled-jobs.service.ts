import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PublishersService } from '../publishers/publishers.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CleaningRemindersService } from '../cleaning/cleaning-reminders.service';

@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(
    private readonly publishersService: PublishersService,
    private readonly pushNotificationsService: PushNotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly cleaningReminders: CleaningRemindersService,
  ) {}

  /**
   * Cleaning reminders — every 15 minutes. Each tick checks, per congregation
   * and in its local timezone, whether a reminder is due: 2h before each
   * meeting (after-meeting group), Monday 09:00 (weekly group + windows), and
   * 2h before the day the weekly group agreed on. A reminder_log row makes
   * every send idempotent, so delayed ticks or restarts never double-send.
   * The cadence must match TICK_MINUTES in CleaningRemindersService.
   */
  @Cron('*/15 * * * *', {
    name: 'cleaning-reminders',
    timeZone: 'UTC',
  })
  async handleCleaningReminders(): Promise<void> {
    try {
      await this.cleaningReminders.runTick();
    } catch (err) {
      this.logger.error('[CleaningReminders] tick failed', err as Error);
    }
  }

  /** Daily housekeeping of the reminder ledger. Runs at 04:00 UTC. */
  @Cron('0 4 * * *', {
    name: 'cleaning-reminder-log-cleanup',
    timeZone: 'UTC',
  })
  async handleReminderLogCleanup(): Promise<void> {
    try {
      const deleted = await this.cleaningReminders.cleanupOldLog();
      this.logger.log(`[CleaningReminders] log cleanup — deleted=${deleted}`);
    } catch (err) {
      this.logger.error('[CleaningReminders] log cleanup failed', err as Error);
    }
  }

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
      const summary = await this.publishersService.recomputeEveryCongregation();
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

  /**
   * Cron — daily cleanup of audit_logs older than 12 months, enforcing the
   * retention period stated in the privacy policy (storage limitation,
   * GDPR Art. 5(1)(e)). Runs at 03:45 UTC, after the other nightly jobs.
   */
  @Cron('45 3 * * *', {
    name: 'audit-log-cleanup',
    timeZone: 'UTC',
  })
  async handleAuditLogCleanup(): Promise<void> {
    this.logger.log('[AuditLogCleanup] starting daily cleanup...');
    const start = Date.now();
    try {
      const deleted = await this.auditLogService.cleanupOldAuditLogs();
      const tookMs = Date.now() - start;
      this.logger.log(
        `[AuditLogCleanup] done — deleted=${deleted} tookMs=${tookMs}`,
      );
    } catch (err: any) {
      this.logger.error(
        '[AuditLogCleanup] daily cleanup failed',
        err?.stack ?? err?.message ?? String(err),
      );
    }
  }
}
