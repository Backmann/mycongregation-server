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
  let responsibilities: any;
  let assignmentsRepo: any;
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
    // What the caller holds, and the row a meeting part belongs to — both
    // consulted before anything is put back.
    responsibilities = { count: jest.fn(async () => 1) };
    assignmentsRepo = {
      findOne: jest.fn(async () => ({ id: 'a-1', eventType: 'midweek' })),
    };
    assignments = { update: jest.fn(async () => ({})) };
    localNeeds = { update: jest.fn(async () => ({})) };
    absences = { update: jest.fn(async () => ({})) };
    halls = { update: jest.fn(async () => ({})) };
    // Only the four the tests exercise are real stand-ins; the rest of the
    // registry is wired the same way and adds nothing to what these prove.
    const unused = { update: jest.fn(async () => ({})) } as never;
    service = new AuditRevertService(
      logRepo,
      responsibilities,
      assignmentsRepo,
      assignments,
      localNeeds,
      absences,
      halls,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
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

  it('handles the kinds the registry covers, one service each', async () => {
    // The registry grew to every kind whose edit is an ordinary partial one.
    // What protects it is not a short list but the route: each goes through
    // its own service, so each service's rules still apply.
    logRepo.findOne = jest.fn(async () =>
      entry({
        entityType: 'local_need',
        entityId: 'topic-1',
        beforeJson: JSON.stringify({ title: 'Было' }),
        afterJson: JSON.stringify({ title: 'Стало' }),
      }),
    );

    await service.revert('cong-1', 'log-1', elder);

    expect(localNeeds.update).toHaveBeenCalledWith(
      'cong-1',
      'topic-1',
      { title: 'Было' },
      elder,
    );
    expect(assignments.update).not.toHaveBeenCalled();
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

  it('refuses an elder a kind his own screens would refuse him', async () => {
    // A revert calls the service DIRECTLY and so walks past the guard on the
    // controller. Halls are an administrator's business; without this check
    // any elder could edit one through the journal — a way in the app does
    // not have anywhere else.
    logRepo.findOne = jest.fn(async () =>
      entry({
        entityType: 'hall',
        entityId: 'hall-1',
        beforeJson: JSON.stringify({ name: 'Было' }),
        afterJson: JSON.stringify({ name: 'Стало' }),
      }),
    );

    const plan = await service.preview('cong-1', 'log-1', elder);

    expect(plan.supported).toBe(false);
    expect(plan.reason).toBe('notAllowed');
  });

  it('lets an administrator put the same thing back', async () => {
    logRepo.findOne = jest.fn(async () =>
      entry({
        entityType: 'hall',
        entityId: 'hall-1',
        beforeJson: JSON.stringify({ name: 'Было' }),
        afterJson: JSON.stringify({ name: 'Стало' }),
      }),
    );

    const plan = await service.preview('cong-1', 'log-1', {
      id: 'u-admin',
      role: UserRole.ADMIN,
      congregationId: 'cong-1',
    } as never);

    expect(plan.supported).toBe(true);
  });

  it('judges a meeting part by its own section', async () => {
    // The same rule the section guard uses: the brother over Life and Ministry
    // may undo a midweek part, and a weekend one is not his to undo.
    responsibilities.count = jest.fn(async () => 0);

    const plan = await service.preview('cong-1', 'log-1', elder);

    expect(plan.reason).toBe('notAllowed');
  });

  it('applies nothing when the person may not', async () => {
    responsibilities.count = jest.fn(async () => 0);

    await expect(
      service.revert('cong-1', 'log-1', elder),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assignments.update).not.toHaveBeenCalled();
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
