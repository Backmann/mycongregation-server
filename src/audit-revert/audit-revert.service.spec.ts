// The revert service names the feature services in its constructor, so this
// spec pulls in the assignments service and, through it, the Expo SDK — which
// is ESM and breaks Jest's default transform inside node_modules. The same
// stand-in the scheduled-jobs spec uses.
jest.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(messages: unknown[]) {
      return [messages];
    }
    sendPushNotificationsAsync() {
      return Promise.resolve([]);
    }
    getPushNotificationReceiptsAsync() {
      return Promise.resolve({});
    }
  },
}));

import { BadRequestException } from '@nestjs/common';
import { AuditRevertService } from './audit-revert.service';
import { UserRole } from '../common/enums/user-role.enum';

describe('AuditRevertService', () => {
  let logRepo: any;
  let assignments: any;
  let localNeeds: any;
  let absences: any;
  let halls: any;
  let service: AuditRevertService;

  const elder = {
    id: 'u-elder',
    role: UserRole.ELDER,
    congregationId: 'cong-1',
  } as any;
  const publisher = {
    id: 'u-pub',
    role: UserRole.PUBLISHER,
    congregationId: 'cong-1',
  } as any;

  const entry = (over: Record<string, any> = {}) => ({
    id: 'log-1',
    congregationId: 'cong-1',
    entityType: 'assignment',
    entityId: 'a-1',
    action: 'UPDATE',
    redactedAt: null,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    beforeJson: JSON.stringify({ partTitle: 'Было' }),
    afterJson: JSON.stringify({ partTitle: 'Стало' }),
    ...over,
  });

  beforeEach(() => {
    logRepo = {
      findOne: jest.fn(async () => entry()),
      count: jest.fn(async () => 0),
    };
    assignments = { update: jest.fn(async () => ({})) };
    localNeeds = { update: jest.fn(async () => ({})) };
    absences = { update: jest.fn(async () => ({})) };
    halls = { update: jest.fn(async () => ({})) };
    service = new AuditRevertService(
      logRepo,
      assignments,
      localNeeds,
      absences,
      halls,
    );
  });

  it('shows what would change, from what to what', async () => {
    const plan = await service.preview('cong-1', 'log-1', elder);

    expect(plan.supported).toBe(true);
    expect(plan.fields).toEqual([
      { field: 'partTitle', from: 'Стало', to: 'Было' },
    ]);
  });

  it('says how many times the record was touched since', async () => {
    // The part worth pausing over: putting an old value back would quietly
    // undo somebody else's later work as well.
    logRepo.count = jest.fn(async () => 2);

    const plan = await service.preview('cong-1', 'log-1', elder);

    expect(plan.changedAfter).toBe(2);
  });

  it('applies it through the module\u2019s own update, not to the table', async () => {
    // Which is what keeps every rule in force: a frozen week stays frozen, a
    // closed month stays closed, and the revert is journalled like any edit.
    await service.revert('cong-1', 'log-1', elder);

    expect(assignments.update).toHaveBeenCalledWith('cong-1', 'a-1', {
      partTitle: 'Было',
    });
  });

  it('brings back only fields on the allowlist', async () => {
    // A service called straight from here skips the validation pipe that
    // normally filters a DTO, so the filter has to live in the registry.
    logRepo.findOne = jest.fn(async () =>
      entry({
        beforeJson: JSON.stringify({
          partTitle: 'Было',
          congregationId: 'somebody-else',
          id: 'another-row',
        }),
        afterJson: JSON.stringify({ partTitle: 'Стало' }),
      }),
    );

    await service.revert('cong-1', 'log-1', elder);

    expect(assignments.update).toHaveBeenCalledWith('cong-1', 'a-1', {
      partTitle: 'Было',
    });
  });

  it('refuses a kind of record it does not handle', async () => {
    // Reports and pioneer records are regulated documents; half-handling them
    // would be worse than saying no.
    logRepo.findOne = jest.fn(async () =>
      entry({ entityType: 'service_report' }),
    );

    const plan = await service.preview('cong-1', 'log-1', elder);

    expect(plan.supported).toBe(false);
    expect(plan.reason).toBe('entityNotSupported');
  });

  it('refuses anything that was not an edit', async () => {
    logRepo.findOne = jest.fn(async () => entry({ action: 'DELETE' }));

    const plan = await service.preview('cong-1', 'log-1', elder);

    expect(plan.reason).toBe('notAnEdit');
  });

  it('refuses an entry whose contents were erased on request', async () => {
    logRepo.findOne = jest.fn(async () =>
      entry({ redactedAt: new Date('2026-08-02T00:00:00Z') }),
    );

    const plan = await service.preview('cong-1', 'log-1', elder);

    expect(plan.reason).toBe('redacted');
  });

  it('keeps an ordinary publisher out entirely', async () => {
    await expect(
      service.preview('cong-1', 'log-1', publisher),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not apply anything it refused to plan', async () => {
    logRepo.findOne = jest.fn(async () => entry({ entityType: 'user' }));

    await expect(
      service.revert('cong-1', 'log-1', elder),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assignments.update).not.toHaveBeenCalled();
  });
});
