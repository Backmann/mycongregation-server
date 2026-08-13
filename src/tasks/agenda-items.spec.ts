jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { ForbiddenException } from '@nestjs/common';
import { AgendaItemsService } from './agenda-items.service';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

const elder = {
  id: 'u-elder',
  role: UserRole.ELDER,
  congregationId: 'c1',
} as never;

describe('AgendaItemsService', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const items = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      save: jest.fn(async (x: unknown) => x),
      create: jest.fn((x: unknown) => x),
      update: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      ...(over.items as object),
    };
    const meetings = {
      findOne: jest.fn(async () => ({ id: 'm1', congregationId: 'c1' })),
      ...(over.meetings as object),
    };
    const responsibilities = {
      count: jest.fn(async () => 0),
      ...(over.responsibilities as object),
    };
    const publishers = {
      findOne: jest.fn(async () => null),
      ...(over.publishers as object),
    };
    return {
      service: new AgendaItemsService(
        items as never,
        meetings as never,
        responsibilities as never,
        publishers as never,
        // Tasks — only reached when a question becomes one.
        { createTask: jest.fn(async () => ({ id: 'task-1' })) } as never,
      ),
      items,
    };
  };

  it('shows an ordinary elder nothing while the agenda is a draft', async () => {
    // Silent rather than refused: he sees a meeting is planned, with no items
    // yet. «Hidden» would invite him to ask what is being hidden.
    const { service, items } = build();

    const list = await service.list(elder, 'm1');

    expect(list).toEqual([]);
    expect(items.find).not.toHaveBeenCalled();
  });

  it('shows every elder the items once it is approved', async () => {
    const { service, items } = build({
      meetings: {
        findOne: jest.fn(async () => ({
          id: 'm1',
          congregationId: 'c1',
          approvedAt: new Date(),
        })),
      },
      items: { find: jest.fn(async () => [{ id: 'i1' }]) },
    });

    const list = await service.list(elder, 'm1');

    expect(list).toHaveLength(1);
    expect(items.find).toHaveBeenCalled();
  });

  it('lets the coordinator build it', async () => {
    const { service } = build({
      responsibilities: { count: jest.fn(async () => 1) },
    });

    expect(await service.mayBuild(elder)).toBe(true);
  });

  it('refuses an ordinary elder the building of it', async () => {
    const { service } = build();

    await expect(
      service.create(elder, 'm1', { title: 'вопрос' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the named recorder write what was decided', async () => {
    // Two people writing the record at once overwrite each other, so it is one
    // brother — the one the meeting names.
    const { service } = build({
      meetings: {
        findOne: jest.fn(async () => ({
          id: 'm1',
          congregationId: 'c1',
          minuteTakerPublisherId: 'p-rec',
        })),
      },
      publishers: {
        findOne: jest.fn(async () => ({ id: 'p-rec', userId: 'u-elder' })),
      },
    });

    const meeting = {
      id: 'm1',
      congregationId: 'c1',
      minuteTakerPublisherId: 'p-rec',
    };
    expect(await service.mayRecord(elder, meeting as never)).toBe(true);
  });

  it('falls back to the secretary when nobody was named', async () => {
    const { service } = build({
      responsibilities: {
        count: jest.fn(async (q: { where: { type: string }[] }) =>
          q.where.some((w) => w.type === ResponsibilityType.SECRETARY) ? 1 : 0,
        ),
      },
    });

    const meeting = {
      id: 'm1',
      congregationId: 'c1',
      minuteTakerPublisherId: null,
    };
    expect(await service.mayRecord(elder, meeting as never)).toBe(true);
  });

  it('turns a question into work, carrying its area with it', async () => {
    // The area is the reason it lives on the question at all: a task cannot be
    // saved without one, and asking again at this moment would be asking for
    // something already known.
    // Typed loosely: the point of the test is WHAT was passed, not its shape.
    const createTask = jest.fn(
      async (_cong: string, _input: Record<string, unknown>, _by: string) => ({
        id: 'task-9',
      }),
    );
    const items = {
      findOne: jest.fn(async () => ({
        id: 'i1',
        congregationId: 'c1',
        meetingId: 'm1',
        title: 'вопрос о счетах',
        area: 'accounts',
        sourceText: 'km 3/24',
      })),
      save: jest.fn(async (x: unknown) => x),
    };
    const service = new AgendaItemsService(
      items as never,
      {
        findOne: jest.fn(async () => ({
          id: 'm1',
          congregationId: 'c1',
          minuteTakerPublisherId: null,
        })),
      } as never,
      { count: jest.fn(async () => 1) } as never,
      { findOne: jest.fn(async () => null) } as never,
      { createTask } as never,
    );

    const saved = await service.makeTask(elder, 'i1', {
      assigneePublisherIds: ['p1'],
      dueDate: '2026-09-01',
    });

    expect(createTask.mock.calls[0][1]).toMatchObject({
      title: 'вопрос о счетах',
      area: 'accounts',
      assigneePublisherIds: ['p1'],
      dueDate: '2026-09-01',
    });
    // The item remembers what it became; deleting that task later does not
    // erase the record that something was decided here.
    expect(saved.outcome).toBe('task');
    expect(saved.taskId).toBe('task-9');
  });

  it('carries the unsettled to the next meeting and settles nothing itself', async () => {
    const rows = [
      { id: 'a', outcome: null, meetingId: 'm1' },
      { id: 'b', outcome: 'reviewed', meetingId: 'm1' },
      { id: 'c', outcome: 'carried', meetingId: 'm1' },
    ];
    const { service, items } = build({
      items: { find: jest.fn(async () => rows) },
    });

    const moved = await service.carryOver('c1', 'm1', 'm2');

    // Reviewed stays where it happened; the other two travel.
    expect(moved).toBe(2);
    expect(items.save).toHaveBeenCalledTimes(2);
  });

  it('lets a new meeting adopt whatever was waiting', async () => {
    // Otherwise a question carried over in May sits unattached until somebody
    // notices — the very losing this exists to prevent.
    const { service, items } = build({
      items: { find: jest.fn(async () => [{ id: 'w1' }, { id: 'w2' }]) },
    });

    const adopted = await service.adoptWaiting('c1', 'm9');

    expect(adopted).toBe(2);
    expect(items.save).toHaveBeenCalledTimes(2);
  });
});
