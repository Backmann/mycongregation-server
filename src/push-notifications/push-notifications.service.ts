import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { PushToken } from '../entities/push-token.entity';
import { UserRole } from '../common/enums/user-role.enum';

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly expo = new Expo();

  constructor(
    @InjectRepository(PushToken)
    private readonly pushTokenRepo: Repository<PushToken>,
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
    if (tokens.length === 0) {
      this.logger.log(
        `No push recipients in tenant=${tenantId}; skipping send`,
      );
      return;
    }

    const title = 'Status changed';
    const body = `${publisher.displayName}: ${before} → ${after}`;
    const data = {
      type: 'publisher_status_change',
      publisherId: publisher.id,
      publisherName: publisher.displayName,
      before,
      after,
    };

    await this.sendBatch(
      tokens.map((t) => t.token),
      title,
      body,
      data,
    );
  }

  private async sendBatch(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, any>,
  ): Promise<void> {
    const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
    if (valid.length === 0) {
      this.logger.warn('No valid Expo push tokens to send to');
      return;
    }

    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data,
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await this.expo.sendPushNotificationsAsync(chunk);
      } catch (err: any) {
        this.logger.warn(
          `sendPushNotificationsAsync failed: ${err?.message ?? err}`,
        );
      }
    }
  }
}
