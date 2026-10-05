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
    {} as never,
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

/**
 * A MEETING REMOVED LEAVES A LINE.
 *
 * The agenda items go with the meeting — the database cascades — and for a
 * meeting already held they are its record. That used to happen with no
 * entry at all (5 October 2026).
 */
describe('TasksService.removeMeeting — the journal', () => {
  function build(opts: {
    meeting?: { id: string; date: string } | null;
    items?: { id: string; outcome: string | null }[];
    journalFails?: boolean;
  }) {
    const calls: Call[] = [];
    const removed: string[] = [];
    const order: string[] = [];
    const meeting =
      opts.meeting === undefined
        ? { id: 'm1', date: '2026-09-05', congregationId: 'c1' }
        : opts.meeting;
    const service = new TasksService(
      {} as never,
      {
        findOne: async () => meeting,
        remove: async (e: { id: string }) => {
          order.push('remove');
          removed.push(e.id);
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        logEvent: async (o: Record<string, any>) => {
          order.push('journal');
          if (opts.journalFails) throw new Error('journal down');
          calls.push({ method: 'logEvent', opts: o });
        },
      } as never,
      {
        find: async (q: { where: { meetingId: string } }) => {
          order.push('count');
          return q.where.meetingId === 'm1' ? (opts.items ?? []) : [];
        },
      } as never,
    );
    return { service, calls, removed, order };
  }

  const ITEMS = [
    { id: 'i1', outcome: 'reviewed' },
    { id: 'i2', outcome: null },
    { id: 'i3', outcome: 'carried' },
  ];

  it('names the date, the items and how many carried an outcome', async () => {
    const { service, calls } = build({ items: ITEMS });

    const out = await service.removeMeeting('c1', 'm1', 'u-coord');

    expect(out).toEqual({
      date: '2026-09-05',
      agendaItems: 3,
      agendaOutcomes: 2,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({
      tenantId: 'c1',
      entityType: 'elders_meeting',
      entityId: 'm1',
      action: 'DELETE',
      actorUserId: 'u-coord',
      detail: { date: '2026-09-05', agendaItems: 3, agendaOutcomes: 2 },
    });
  });

  // Counted before the cascade takes them, or the entry would always say 0.
  it('counts the items BEFORE the meeting goes', async () => {
    const { service, order } = build({ items: ITEMS });
    await service.removeMeeting('c1', 'm1', 'u1');
    expect(order).toEqual(['count', 'remove', 'journal']);
  });

  it('an empty evening is still journalled', async () => {
    const { service, calls } = build({ items: [] });
    const out = await service.removeMeeting('c1', 'm1', 'u1');
    expect(out).toEqual({
      date: '2026-09-05',
      agendaItems: 0,
      agendaOutcomes: 0,
    });
    expect(calls).toHaveLength(1);
  });

  // The journal is read by every administrator; the agenda by the body.
  it('carries no word of any item', async () => {
    const { service, calls } = build({
      items: [{ id: 'i1', outcome: 'reviewed', title: 'тайное' } as never],
    });
    await service.removeMeeting('c1', 'm1', 'u1');
    expect(JSON.stringify(calls)).not.toContain('тайное');
    expect(Object.keys(calls[0].opts.detail).sort()).toEqual([
      'agendaItems',
      'agendaOutcomes',
      'date',
    ]);
  });

  it('a journal that fails does not bring the removal back', async () => {
    const { service, removed } = build({ items: ITEMS, journalFails: true });
    await expect(service.removeMeeting('c1', 'm1', 'u1')).resolves.toEqual({
      date: '2026-09-05',
      agendaItems: 3,
      agendaOutcomes: 2,
    });
    expect(removed).toEqual(['m1']);
  });

  it('a meeting that is not there is refused and nothing is written', async () => {
    const { service, calls, removed } = build({ meeting: null });
    await expect(service.removeMeeting('c1', 'm1', 'u1')).rejects.toThrow(
      'Meeting not found',
    );
    expect(calls).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });
});
