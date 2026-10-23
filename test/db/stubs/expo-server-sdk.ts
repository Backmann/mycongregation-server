/**
 * No push leaves a test run. The real package is an ES module the test
 * runner does not load, and a test must never reach Expo's servers anyway.
 * What the server asks of it, answered as «nothing sent».
 */
export type ExpoPushMessage = Record<string, unknown>;
export type ExpoPushReceipt = Record<string, unknown>;
export type ExpoPushTicket = Record<string, unknown>;

export class Expo {
  static isExpoPushToken(token: unknown): boolean {
    return typeof token === 'string' && token.startsWith('ExponentPushToken[');
  }
  chunkPushNotifications<T>(messages: T[]): T[][] {
    return messages.length ? [messages] : [];
  }
  chunkPushNotificationReceiptIds(ids: string[]): string[][] {
    return ids.length ? [ids] : [];
  }
  async sendPushNotificationsAsync(
    messages: unknown[],
  ): Promise<ExpoPushTicket[]> {
    return messages.map(() => ({ status: 'ok', id: 'dbtest' }));
  }
  async getPushNotificationReceiptsAsync(): Promise<
    Record<string, ExpoPushReceipt>
  > {
    return {};
  }
}
