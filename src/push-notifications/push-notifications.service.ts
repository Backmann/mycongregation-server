import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { Expo, ExpoPushMessage, ExpoPushReceipt } from 'expo-server-sdk';
import { PushToken } from '../entities/push-token.entity';
import { PushReceipt } from '../entities/push-receipt.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import {
  coerceLanguage,
  DEFAULT_LANGUAGE,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { PUSH_STRINGS, translateStatus } from '../common/i18n/push-strings';
import { WebPushService } from '../web-push/web-push.service';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';

type SendBatchResult = {
  token: string;
  ticketId: string | null;
  errorCode: string | null;
};

type PendingReceipt = {
  ticketId: string;
  token: string;
  userId: string;
  congregationId: string;
  status: 'pending';
  errorCode: null;
  sentAt: Date;
};

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly expo = new Expo();

  constructor(
    @InjectRepository(PushToken)
    private readonly pushTokenRepo: Repository<PushToken>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PushReceipt)
    private readonly pushReceiptRepo: Repository<PushReceipt>,
    private readonly webPushService: WebPushService,
  ) {}

  /**
   * Upsert a push token for the given user. The role is captured at
   * registration time as a denormalized snapshot — if a user is later
   * promoted/demoted, they must re-register to get the new role's pushes.
   */
  async registerToken(
    userId: string,
    congregationId: string,
    role: UserRole,
    token: string,
    deviceInfo?: Record<string, any>,
  ): Promise<PushToken> {
    if (!Expo.isExpoPushToken(token)) {
      throw new BadRequestException('Invalid Expo push token.');
    }

    const existing = await this.pushTokenRepo.findOne({
      where: { userId, token },
    });
    if (existing) {
      existing.role = role;
      existing.congregationId = congregationId;
      existing.deviceInfo = deviceInfo ?? existing.deviceInfo;
      return this.pushTokenRepo.save(existing);
    }

    const fresh = this.pushTokenRepo.create({
      userId,
      congregationId,
      role,
      token,
      deviceInfo: deviceInfo ?? null,
    });
    return this.pushTokenRepo.save(fresh);
  }

  /** Remove a push token by (userId, token). Idempotent. */
  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.pushTokenRepo.delete({ userId, token });
  }

  /**
   * Send a status-change push to every admin/elder in the congregation,
   * optionally excluding one user (typically the publisher's own linked
   * user — they don't need an alert about themselves).
   *
   * Best-effort: catches all errors internally and logs them. The caller
   * (recomputeStatus) should treat this as fire-and-forget.
   */
  async sendStatusChange(
    tenantId: string,
    publisher: { id: string; displayName: string },
    before: string,
    after: string,
    excludeUserId?: string,
  ): Promise<void> {
    const where: Record<string, unknown> = {
      congregationId: tenantId,
      role: In([UserRole.ADMIN, UserRole.ELDER]),
    };
    if (excludeUserId) {
      where.userId = Not(excludeUserId);
    }

    const tokens = await this.pushTokenRepo.find({ where });
    const webSubs = await this.webPushService.getSubscriptionsByTenant(
      tenantId,
      excludeUserId,
    );
    if (tokens.length === 0 && webSubs.length === 0) {
      this.logger.log(
        `No push recipients in tenant=${tenantId}; skipping send`,
      );
      return;
    }

    // Fetch recipient languages so notifications arrive in each user's preferred
    // language. Fresh lookup per send — avoids stale snapshots on language change.
    const userIds = [
      ...new Set(
        [
          ...tokens.map((t) => t.userId),
          ...webSubs.map((s) => s.userId),
        ].filter(Boolean),
      ),
    ];
    let langByUserId = new Map<string, SupportedLanguage>();
    if (userIds.length > 0) {
      const users = await this.userRepo.findBy({ id: In(userIds) });
      langByUserId = new Map(
        users.map((u) => [u.id, coerceLanguage(u.uiLanguage)]),
      );
    }

    // Group tokens by recipient language; unknown defaults to DEFAULT_LANGUAGE.
    const tokensByLang = new Map<SupportedLanguage, string[]>();
    for (const t of tokens) {
      const lang = langByUserId.get(t.userId) ?? DEFAULT_LANGUAGE;
      if (!tokensByLang.has(lang)) tokensByLang.set(lang, []);
      tokensByLang.get(lang)!.push(t.token);
    }

    const data = {
      type: 'publisher_status_change',
      publisherId: publisher.id,
      publisherName: publisher.displayName,
      before,
      after,
    };

    // Build token → userId map for receipt persistence.
    const userIdByToken = new Map<string, string>();
    for (const t of tokens) {
      userIdByToken.set(t.token, t.userId);
    }

    const now = new Date();

    // Per-language batch send + persist successful tickets for later receipt
    // checking (the cron in ScheduledJobsService will fetch receipts and act
    // on errors like DeviceNotRegistered).
    for (const [lang, langTokens] of tokensByLang) {
      const strings = PUSH_STRINGS[lang].statusChange;
      const results = await this.sendBatch(
        langTokens,
        strings.title,
        strings.body({
          publisher: publisher.displayName,
          before: translateStatus(before, lang),
          after: translateStatus(after, lang),
        }),
        data,
      );

      const receipts: PendingReceipt[] = [];
      for (const r of results) {
        if (!r.ticketId) continue;
        const userId = userIdByToken.get(r.token);
        if (!userId) continue;
        receipts.push({
          ticketId: r.ticketId,
          token: r.token,
          userId,
          congregationId: tenantId,
          status: 'pending',
          errorCode: null,
          sentAt: now,
        });
      }
      if (receipts.length > 0) {
        await this.pushReceiptRepo.save(receipts);
      }

      const immediateErrors = results.filter((r) => r.errorCode);
      if (immediateErrors.length > 0) {
        this.logger.warn(`Push send had ${immediateErrors.length} immediate errors: ${immediateErrors.map((e) => e.errorCode).join(', ')}`);
      }
    }

    // === Web Push (PWA) delivery — in parallel with Expo, same payload model ===
    if (webSubs.length > 0) {
      const subsByLang = new Map<SupportedLanguage, WebPushSubscription[]>();
      for (const sub of webSubs) {
        const lang = langByUserId.get(sub.userId) ?? DEFAULT_LANGUAGE;
        if (!subsByLang.has(lang)) subsByLang.set(lang, []);
        subsByLang.get(lang)!.push(sub);
      }

      for (const [lang, langSubs] of subsByLang) {
        const strings = PUSH_STRINGS[lang].statusChange;
        const payload = {
          title: strings.title,
          body: strings.body({
            publisher: publisher.displayName,
            before: translateStatus(before, lang),
            after: translateStatus(after, lang),
          }),
          data,
        };

        await Promise.all(
          langSubs.map((sub) => this.webPushService.sendToSubscription(sub, payload)),
        );
      }
    }
  }

  /**
   * Low-level batch send. Returns one result per input token (same order),
   * so the caller can persist tickets (status='pending') for later receipt
   * checking and log immediate errors.
   */
  private async sendBatch(tokens: string[], title: string, body: string, data: Record<string, any>): Promise<SendBatchResult[]> {
    const results: SendBatchResult[] = [];

    const valid: string[] = [];
    for (const token of tokens) {
      if (Expo.isExpoPushToken(token)) {
        valid.push(token);
      } else {
        results.push({ token, ticketId: null, errorCode: 'InvalidExpoPushToken' });
      }
    }
    if (valid.length === 0) {
      this.logger.warn('No valid Expo push tokens to send to');
      return results;
    }

    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data,
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    let validIdx = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < chunk.length; i++) {
          const ticket = tickets[i];
          const token = valid[validIdx];
          if (!ticket) {
            results.push({ token, ticketId: null, errorCode: 'NoTicket' });
          } else if (ticket.status === 'ok') {
            results.push({ token, ticketId: ticket.id, errorCode: null });
          } else {
            results.push({ token, ticketId: null, errorCode: ticket.details?.error ?? 'SendError' });
          }
          validIdx++;
        }
      } catch (err: any) {
        this.logger.warn(`sendPushNotificationsAsync failed: ${err?.message ?? err}`);
        for (let i = 0; i < chunk.length; i++) {
          results.push({ token: valid[validIdx], ticketId: null, errorCode: 'NetworkError' });
          validIdx++;
        }
      }
    }

    return results;
  }

  /**
   * Cron-driven: fetch receipts for tickets sent at least 15 minutes ago,
   * update push_receipts.status, and clean up push_tokens for which Expo
   * reports DeviceNotRegistered. Called by ScheduledJobsService every 30 min.
   */
  async checkReceipts(): Promise<{ checked: number; ok: number; errors: number; tokensDeleted: number }> {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const pending = await this.pushReceiptRepo.find({
      where: { status: 'pending', sentAt: LessThan(cutoff) },
      take: 1000,
    });

    if (pending.length === 0) {
      return { checked: 0, ok: 0, errors: 0, tokensDeleted: 0 };
    }

    const receiptByTicketId = new Map<string, PushReceipt>();
    for (const r of pending) {
      receiptByTicketId.set(r.ticketId, r);
    }

    const ticketIds = pending.map((r) => r.ticketId);
    const chunks = this.expo.chunkPushNotificationReceiptIds(ticketIds);

    let okCount = 0;
    let errorCount = 0;
    const tokensToDelete = new Set<string>();
    const now = new Date();

    for (const chunk of chunks) {
      let receiptsMap: { [id: string]: ExpoPushReceipt };
      try {
        receiptsMap = await this.expo.getPushNotificationReceiptsAsync(chunk);
      } catch (err: any) {
        this.logger.warn(`getPushNotificationReceiptsAsync failed: ${err?.message ?? err}`);
        continue;
      }

      for (const ticketId of chunk) {
        const expoReceipt = receiptsMap[ticketId];
        const ourReceipt = receiptByTicketId.get(ticketId);
        if (!ourReceipt) continue;
        // Receipt not yet available — Expo still processing; leave as pending.
        if (!expoReceipt) continue;

        if (expoReceipt.status === 'ok') {
          ourReceipt.status = 'ok';
          ourReceipt.errorCode = null;
          okCount++;
        } else {
          const errorCode = expoReceipt.details?.error ?? 'Unknown';
          ourReceipt.status = 'error';
          ourReceipt.errorCode = errorCode;
          errorCount++;
          if (errorCode === 'DeviceNotRegistered') {
            tokensToDelete.add(ourReceipt.token);
          }
        }
        ourReceipt.checkedAt = now;
      }
    }

    const checked = pending.filter((r) => r.checkedAt !== null);
    if (checked.length > 0) {
      await this.pushReceiptRepo.save(checked);
    }

    let tokensDeleted = 0;
    if (tokensToDelete.size > 0) {
      const result = await this.pushTokenRepo.delete({
        token: In([...tokensToDelete]),
      });
      tokensDeleted = result.affected ?? 0;
    }

    return { checked: checked.length, ok: okCount, errors: errorCount, tokensDeleted };
  }

  /**
   * Daily cleanup: delete push_receipts older than 7 days regardless of
   * status. Expo only keeps receipt data for ~24h, so 'pending' rows past
   * that age will never resolve. Called by ScheduledJobsService at 03:30 UTC.
   */
  async cleanupOldReceipts(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.pushReceiptRepo.delete({
      sentAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}
