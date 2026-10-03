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
import {
  PUSH_STRINGS,
  translateStatus,
  MEETING_NAMES,
} from '../common/i18n/push-strings';
import { WebPushService } from '../web-push/web-push.service';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { webDeviceKind } from '../web-push/device-kind';

/**
 * Where one person was reached by one send.
 *
 * `no_device` is not a failure of ours: the person has neither a phone token
 * nor a browser subscription, so there was nowhere to send. `failed` means
 * there WAS a device and nothing got through.
 */
export type PushReach = 'phone' | 'web' | 'no_device' | 'failed';

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

    // One phone, one person. The token names the DEVICE, and a row is kept per
    // (user, token) — so when a second person signed in on the same phone the
    // first one's row stayed, and everything meant for him kept arriving on a
    // phone he no longer held. Whoever registers the token now owns it alone.
    await this.pushTokenRepo.delete({ token, userId: Not(userId) });

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
  /**
   * Notify a SINGLE user of a publisher's status change. Used for the group
   * overseer only — status changes are sensitive and must not fan out to all
   * elders or the congregation. Both the Expo tokens and the web-push subs are
   * scoped to `recipientUserId`.
   */
  async sendStatusChangeToUser(
    tenantId: string,
    recipientUserId: string,
    publisher: { id: string; displayName: string },
    before: string,
    after: string,
  ): Promise<void> {
    return this.sendStatusChange(
      tenantId,
      publisher,
      before,
      after,
      undefined,
      recipientUserId,
    );
  }

  async sendStatusChange(
    tenantId: string,
    publisher: { id: string; displayName: string },
    before: string,
    after: string,
    excludeUserId?: string,
    onlyUserId?: string,
  ): Promise<void> {
    const where: Record<string, unknown> = {
      congregationId: tenantId,
    };
    if (onlyUserId) {
      // Scoped delivery to a single recipient (the group overseer).
      where.userId = onlyUserId;
    } else {
      where.role = In([UserRole.ADMIN, UserRole.ELDER]);
      if (excludeUserId) {
        where.userId = Not(excludeUserId);
      }
    }

    const tokens = await this.pushTokenRepo.find({ where });
    const webSubs = onlyUserId
      ? await this.webPushService.getSubscriptionsByUser(tenantId, onlyUserId)
      : await this.webPushService.getSubscriptionsByTenant(
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

    // No name here either. Nothing reads it — neither the service worker nor
    // the tap handler — and a push payload is not a place to carry something
    // that is not needed: it sits in the browser's notification store and in
    // the phone's, outside the login that guards everything else.
    const data = {
      type: 'publisher_status_change',
      publisherId: publisher.id,
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
        this.logger.warn(
          `Push send had ${immediateErrors.length} immediate errors: ${immediateErrors.map((e) => e.errorCode).join(', ')}`,
        );
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
            before: translateStatus(before, lang),
            after: translateStatus(after, lang),
          }),
          data,
        };

        await Promise.all(
          langSubs.map((sub) =>
            this.webPushService.sendToSubscription(sub, payload),
          ),
        );
      }
    }
  }

  /** "8 June – 14 June" in the recipient language; falls back to ISO. */

  /**
   * Generic push to a set of users: sends the given title/body to all of
   * their Expo tokens and web-push subscriptions in the tenant. Used by
   * report reminders. Best-effort; single language (text pre-built).
   */
  async sendToUsers(
    tenantId: string,
    userIds: string[],
    title: string,
    body: string,
    data: Record<string, any>,
  ): Promise<Map<string, PushReach>> {
    const uniq = [...new Set(userIds.filter(Boolean))];
    // Everybody starts as «nowhere to send»; a device that takes the message
    // moves its owner on. What is left at the end is the honest answer.
    const reach = new Map<string, PushReach>(
      uniq.map((id) => [id, 'no_device' as PushReach]),
    );
    if (uniq.length === 0) return reach;

    const tokens = await this.pushTokenRepo.find({
      where: { congregationId: tenantId, userId: In(uniq) },
    });
    const allWebSubs = await this.webPushService.getSubscriptionsByTenant(
      tenantId,
      undefined,
    );
    const webSubs = allWebSubs.filter((s) => uniq.includes(s.userId));
    if (tokens.length === 0 && webSubs.length === 0) {
      this.logger.log(`sendToUsers: no recipients in tenant=${tenantId}`);
      return reach;
    }
    // Somebody who HAS a device and is not reached is a failure, not an
    // absence — the two call for different remedies.
    for (const t of tokens) reach.set(t.userId, 'failed');
    for (const s of webSubs) reach.set(s.userId, 'failed');

    // ONE NOTIFICATION A PHYSICAL DEVICE.
    //
    // It used to be «one person, one channel»: with a phone registered, every
    // browser of that person stayed silent. That was written against one real
    // nuisance — the app and a browser subscription on the SAME Android phone
    // saying everything twice — but it silenced far more than that. An iPhone
    // or an iPad is never that phone, and it got nothing; worst, somebody who
    // moved from Android to an iPhone and left the old phone in a drawer was
    // «reached» every time and saw nothing at all (3 October 2026).
    //
    //   - a phone with the app: always;
    //   - an iPhone or iPad: always — it is a device of its own;
    //   - a browser on Android: only when no phone took the message, because
    //     it is most likely the very phone that runs the app;
    //   - a computer: only when no handheld device took it. It is often
    //     shared, and a message read on the phone has done its work.
    //
    // Nobody is left with nothing while a device of theirs could take it: each
    // step down happens exactly when the step above reached nobody.
    const reachedByPhone = new Set<string>();

    if (tokens.length > 0) {
      const userIdByToken = new Map(tokens.map((t) => [t.token, t.userId]));
      const now = new Date();
      const results = await this.sendBatch(
        tokens.map((t) => t.token),
        title,
        body,
        data,
      );
      const receipts: PendingReceipt[] = [];
      for (const r of results) {
        const userId = userIdByToken.get(r.token);
        if (userId && !r.errorCode) {
          reachedByPhone.add(userId);
          reach.set(userId, 'phone');
        }
        if (!r.ticketId) continue;
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
        this.logger.warn(
          `sendToUsers: ${immediateErrors.length} immediate errors: ` +
            immediateErrors.map((e) => e.errorCode).join(', '),
        );
      }
    }

    const payload = { title, body, data };
    const reachedInHand = new Set(reachedByPhone);
    const sendWeb = async (subs: WebPushSubscription[]) => {
      const taken = new Set<string>();
      await Promise.all(
        subs.map(async (sub) => {
          const res = await this.webPushService.sendToSubscription(
            sub,
            payload,
          );
          if (!res.ok) return;
          taken.add(sub.userId);
          // The phone stays the answer when both took it: it is the device
          // the report names first.
          if (!reachedByPhone.has(sub.userId)) reach.set(sub.userId, 'web');
        }),
      );
      return taken;
    };

    const handheld = webSubs.filter((s) => {
      const kind = webDeviceKind(s);
      if (kind === 'ios') return true;
      return kind === 'android' && !reachedByPhone.has(s.userId);
    });
    for (const id of await sendWeb(handheld)) reachedInHand.add(id);

    const computers = webSubs.filter(
      (s) => webDeviceKind(s) === 'desktop' && !reachedInHand.has(s.userId),
    );
    await sendWeb(computers);
    return reach;
  }

  /**
   * To ONE device of one person — the device that asked.
   *
   * «Отправить пробное» is a question about the screen in the person's hand.
   * Sent the ordinary way it goes to the devices the rules above pick, which
   * need not include this one: somebody pressing it in a browser while a
   * phone is registered got the test on the phone, read «отправлено» in the
   * browser, and concluded the browser was broken (3 October 2026). A test
   * goes where it was asked from, or says that this device is not registered
   * at all.
   */
  async sendToDevice(
    tenantId: string,
    userId: string,
    device: { token?: string | null; endpoint?: string | null },
    title: string,
    body: string,
    data: Record<string, any>,
  ): Promise<PushReach> {
    if (device.endpoint) {
      const subs = await this.webPushService.getSubscriptionsByUser(
        tenantId,
        userId,
      );
      const sub = subs.find((s) => s.endpoint === device.endpoint);
      if (!sub) return 'no_device';
      const res = await this.webPushService.sendToSubscription(sub, {
        title,
        body,
        data,
      });
      return res.ok ? 'web' : 'failed';
    }
    if (device.token) {
      const row = await this.pushTokenRepo.findOne({
        where: { congregationId: tenantId, userId, token: device.token },
      });
      if (!row) return 'no_device';
      const [result] = await this.sendBatch([row.token], title, body, data);
      if (result?.ticketId) {
        await this.pushReceiptRepo.save([
          {
            ticketId: result.ticketId,
            token: row.token,
            userId,
            congregationId: tenantId,
            status: 'pending' as const,
            errorCode: null,
            sentAt: new Date(),
          },
        ]);
      }
      return result && !result.errorCode ? 'phone' : 'failed';
    }
    return 'no_device';
  }

  /**
   * Low-level batch send. Returns one result per input token (same order),
   * so the caller can persist tickets (status='pending') for later receipt
   * checking and log immediate errors.
   */
  private async sendBatch(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, any>,
  ): Promise<SendBatchResult[]> {
    const results: SendBatchResult[] = [];

    const valid: string[] = [];
    for (const token of tokens) {
      if (Expo.isExpoPushToken(token)) {
        valid.push(token);
      } else {
        results.push({
          token,
          ticketId: null,
          errorCode: 'InvalidExpoPushToken',
        });
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
            results.push({
              token,
              ticketId: null,
              errorCode: ticket.details?.error ?? 'SendError',
            });
          }
          validIdx++;
        }
      } catch (err: any) {
        this.logger.warn(
          `sendPushNotificationsAsync failed: ${err?.message ?? err}`,
        );
        for (let i = 0; i < chunk.length; i++) {
          results.push({
            token: valid[validIdx],
            ticketId: null,
            errorCode: 'NetworkError',
          });
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
  async checkReceipts(): Promise<{
    checked: number;
    ok: number;
    errors: number;
    tokensDeleted: number;
  }> {
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
        this.logger.warn(
          `getPushNotificationReceiptsAsync failed: ${err?.message ?? err}`,
        );
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

    return {
      checked: checked.length,
      ok: okCount,
      errors: errorCount,
      tokensDeleted,
    };
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
