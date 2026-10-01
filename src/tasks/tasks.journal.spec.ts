// The tasks service names the reminder service, which reaches the push service
// and the Expo SDK — ESM, and Jest's default transform does not touch
// node_modules. The same stand-in the other task specs use.
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

import { TasksService } from './tasks.service';
import { ElderTask } from '../entities/elder-task.entity';

/**
 * 30 September: a deadline moved a year ahead on 24 August left no trace —
 * tasks were never journalled. These pin down what the journal now gets, and,
 * just as firmly, what it must never get: the words of the task.
 */

type Call = { method: string; opts: Record<string, any> };

function harness(stored: Partial<ElderTask>) {
  const calls: Call[] = [];
  const row = {
    id: 't1',
    congregationId: 'c1',
    title: 'Поговорить с братом о здоровье',
    details: 'подробности, которые знает только совет',
    area: 'care',
    assigneeKind: 'people',
    assignees: [{ id: 'p2' }, { id: 'p1' }],
    assigneePublisherId: 'p2',
    dueDate: '2026-08-31',
    dueTime: '19:30:00',
    status: 'open',
    kind: null,
    kindPeriod: null,
    eldersMeetingId: null,
    doneAt: null,
    doneById: null,
    createdById: 'u0',
    ...stored,
  } as unknown as ElderTask;
  const service = new TasksService(
    {
      findOne: async () => ({ ...row, assignees: [...(row.assignees ?? [])] }),
      save: async (e: ElderTask) => ({ ...e, id: e.id ?? 't-new' }),
      create: (e: Partial<ElderTask>) => ({ ...e }),
      remove: async () => undefined,
    } as never,
    {} as never,
    {
      find: async ({ where }: { where: { id: { _value: string[] } } }) =>
        where.id._value.map((id) => ({ id })),
    } as never,
    {} as never,
    { announceAssignment: async () => undefined } as never,
    {
      logCreate: async (opts: Record<string, any>) =>
        void calls.push({ method: 'logCreate', opts }),
      logRawUpdate: async (opts: Record<string, any>) => {
        // The real one writes nothing for an empty list — so must this.
        if (opts.changedFields.length)
          calls.push({ method: 'logRawUpdate', opts });
      },
      logEvent: async (opts: Record<string, any>) =>
        void calls.push({ method: 'logEvent', opts }),
    } as never,
  );
  const words = (c: Call) => JSON.stringify(c.opts);
  return { service, calls, words };
}

describe('TasksService — the journal', () => {
  it('a moved deadline is recorded with both dates and who moved it', async () => {
    const { service, calls } = harness({});
    await service.updateTask('c1', 't1', { dueDate: '2027-08-31' }, 'u-lionel');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('logRawUpdate');
    expect(calls[0].opts.entityType).toBe('elder_task');
    expect(calls[0].opts.actorUserId).toBe('u-lionel');
    expect(calls[0].opts.changedFields).toEqual(['dueDate']);
    expect(calls[0].opts.before).toEqual({ dueDate: '2026-08-31' });
    expect(calls[0].opts.after).toEqual({ dueDate: '2027-08-31' });
  });

  it('never carries the title or the details — not on create, update or delete', async () => {
    const { service, calls, words } = harness({});
    await service.createTask(
      'c1',
      {
        title: 'Поговорить с братом о здоровье',
        details: 'подробности, которые знает только совет',
      },
      'u1',
    );
    await service.updateTask(
      'c1',
      't1',
      { dueDate: '2026-09-15', status: 'done' },
      'u1',
    );
    await service.removeTask('c1', 't1');
    expect(calls.map((c) => c.method)).toEqual([
      'logCreate',
      'logRawUpdate',
      'logEvent',
    ]);
    for (const c of calls) {
      expect(words(c)).not.toContain('здоровье');
      expect(words(c)).not.toContain('только совет');
      expect(words(c)).not.toMatch(/"title"|"details"/);
    }
  });

  it('an edit to the words alone leaves no entry, as with the agenda', async () => {
    const { service, calls } = harness({});
    await service.updateTask(
      'c1',
      't1',
      { title: 'Другие слова', details: 'иначе' },
      'u1',
    );
    expect(calls).toHaveLength(0);
  });

  it('saving the same brothers in another order, and the same time without seconds, is no change', async () => {
    const { service, calls } = harness({});
    await service.updateTask(
      'c1',
      't1',
      { assigneePublisherIds: ['p1', 'p2'], dueTime: '19:30' },
      'u1',
    );
    expect(calls).toHaveLength(0);
  });

  it('names which task the app raised, by its kind', async () => {
    const { service, calls } = harness({
      kind: 'service_overseer_visits',
      title: 'service_overseer_visits',
    });
    await service.updateTask('c1', 't1', { status: 'done' }, 'u1');
    await service.removeTask('c1', 't1');
    expect(calls[1].opts.detail.kind).toBe('service_overseer_visits');
  });
});
