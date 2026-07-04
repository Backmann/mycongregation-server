import { CleaningService } from './cleaning.service';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';

const CONG = '11111111-1111-1111-1111-111111111111';
const groups = [
  { id: 'A', name: 'Group A' },
  { id: 'B', name: 'Group B' },
  { id: 'C', name: 'Group C' },
];

function svcWith(
  repo: any,
  groupRepo: any,
  publisherRepo: any = { findOne: jest.fn(async () => null) },
  responsibilityRepo: any = { count: jest.fn(async () => 0) },
) {
  return new CleaningService(
    repo,
    groupRepo,
    publisherRepo,
    responsibilityRepo,
  );
}

describe('CleaningService.suggestNextAfterMeetingGroup', () => {
  it('returns null when there are no groups', async () => {
    const svc = svcWith(
      { findOne: jest.fn() },
      { find: jest.fn(async () => []) },
    );
    expect(
      await svc.suggestNextAfterMeetingGroup(CONG, '2026-05-18'),
    ).toBeNull();
  });

  it('suggests the first group when nothing was assigned before', async () => {
    const svc = svcWith(
      { findOne: jest.fn(async () => null) },
      { find: jest.fn(async () => groups) },
    );
    expect(await svc.suggestNextAfterMeetingGroup(CONG, '2026-05-18')).toBe(
      'A',
    );
  });

  it('suggests the next group after the most recent one', async () => {
    const svc = svcWith(
      { findOne: jest.fn(async () => ({ serviceGroupId: 'A' })) },
      { find: jest.fn(async () => groups) },
    );
    expect(await svc.suggestNextAfterMeetingGroup(CONG, '2026-05-18')).toBe(
      'B',
    );
  });

  it('wraps around to the first group after the last', async () => {
    const svc = svcWith(
      { findOne: jest.fn(async () => ({ serviceGroupId: 'C' })) },
      { find: jest.fn(async () => groups) },
    );
    expect(await svc.suggestNextAfterMeetingGroup(CONG, '2026-05-18')).toBe(
      'A',
    );
  });

  it('falls back to the first group when the prior group no longer exists', async () => {
    const svc = svcWith(
      { findOne: jest.fn(async () => ({ serviceGroupId: 'GONE' })) },
      { find: jest.fn(async () => groups) },
    );
    expect(await svc.suggestNextAfterMeetingGroup(CONG, '2026-05-18')).toBe(
      'A',
    );
  });
});

describe('CleaningService.setSlot', () => {
  it('forces serviceGroupId to null for the GENERAL slot', async () => {
    const repo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    const out = await svc.setSlot(CONG, {
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.GENERAL,
      serviceGroupId: 'A',
    } as any);
    expect(out.serviceGroupId).toBeNull();
  });

  it('updates the existing row when the slot already exists', async () => {
    const existing = { id: 'r1', serviceGroupId: null } as any;
    const repo = {
      findOne: jest.fn(async () => existing),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    const out = await svc.setSlot(CONG, {
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.AFTER_MEETING,
      serviceGroupId: 'B',
    } as any);
    expect(out.serviceGroupId).toBe('B');
    expect(repo.save).toHaveBeenCalledWith(existing);
  });
});

describe('CleaningService.setSlot windows', () => {
  it('deduplicates and sorts windows for the THOROUGH slot', async () => {
    const repo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    const out = await svc.setSlot(CONG, {
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.THOROUGH,
      serviceGroupId: 'B',
      windows: [5, 4, 5, 1],
    } as any);
    expect(out.windows).toEqual([1, 4, 5]);
  });

  it('forces windows to null for non-THOROUGH slots', async () => {
    const repo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    const out = await svc.setSlot(CONG, {
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.AFTER_MEETING,
      serviceGroupId: 'A',
      windows: [1, 2],
    } as any);
    expect(out.windows).toBeNull();
  });

  it('stores null when the windows list is empty', async () => {
    const repo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    const out = await svc.setSlot(CONG, {
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.THOROUGH,
      serviceGroupId: 'B',
      windows: [],
    } as any);
    expect(out.windows).toBeNull();
  });

  it('resets thoroughPlannedAt when the assigned group changes', async () => {
    const existing = {
      id: 'r1',
      serviceGroupId: 'A',
      thoroughPlannedAt: new Date('2026-05-22T18:00:00Z'),
    } as any;
    const repo = {
      findOne: jest.fn(async () => existing),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    const out = await svc.setSlot(CONG, {
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.THOROUGH,
      serviceGroupId: 'B',
      windows: [3],
    } as any);
    expect(out.thoroughPlannedAt).toBeNull();
    expect(out.serviceGroupId).toBe('B');
  });

  it('keeps thoroughPlannedAt when the group stays the same', async () => {
    const planned = new Date('2026-05-22T18:00:00Z');
    const existing = {
      id: 'r1',
      serviceGroupId: 'A',
      thoroughPlannedAt: planned,
    } as any;
    const repo = {
      findOne: jest.fn(async () => existing),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    const out = await svc.setSlot(CONG, {
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.THOROUGH,
      serviceGroupId: 'A',
      windows: [3, 7],
    } as any);
    expect(out.thoroughPlannedAt).toBe(planned);
    expect(out.windows).toEqual([3, 7]);
  });
});

describe('CleaningService.planThorough', () => {
  const WEEK = '2026-05-18';
  const admin = { id: 'u-admin', role: 'admin' } as any;
  const member = { id: 'u-member', role: 'publisher' } as any;

  function slotRepo(slot: any) {
    return {
      findOne: jest.fn(async () => slot),
      save: jest.fn(async (v: unknown) => v),
    } as any;
  }

  it('404s when the week has no thorough slot with a group', async () => {
    const svc = svcWith(slotRepo(null), { find: jest.fn() });
    await expect(
      svc.planThorough(CONG, { weekStartDate: WEEK, plannedAt: null }, admin),
    ).rejects.toThrow('No thorough cleaning assignment');
  });

  it('allows an admin and saves the planned time', async () => {
    const slot = { serviceGroupId: 'A', thoroughPlannedAt: null } as any;
    const svc = svcWith(slotRepo(slot), { find: jest.fn() });
    const out = await svc.planThorough(
      CONG,
      { weekStartDate: WEEK, plannedAt: '2026-05-22T18:00:00Z' },
      admin,
    );
    expect(out.thoroughPlannedAt).toEqual(new Date('2026-05-22T18:00:00Z'));
  });

  it('allows a cleaning coordinator via responsibility', async () => {
    const slot = { serviceGroupId: 'A', thoroughPlannedAt: null } as any;
    const svc = svcWith(
      slotRepo(slot),
      { find: jest.fn() },
      { findOne: jest.fn(async () => null) },
      { count: jest.fn(async () => 1) },
    );
    const out = await svc.planThorough(
      CONG,
      { weekStartDate: WEEK, plannedAt: '2026-05-20T10:00:00Z' },
      member,
    );
    expect(out.thoroughPlannedAt).toEqual(new Date('2026-05-20T10:00:00Z'));
  });

  it('allows the overseer of the assigned group', async () => {
    const slot = { serviceGroupId: 'A', thoroughPlannedAt: null } as any;
    const svc = svcWith(
      slotRepo(slot),
      {
        find: jest.fn(),
        findOne: jest.fn(async () => ({
          id: 'A',
          overseerPublisherId: 'pub-1',
        })),
      },
      { findOne: jest.fn(async () => ({ id: 'pub-1' })) },
      { count: jest.fn(async () => 0) },
    );
    const out = await svc.planThorough(
      CONG,
      { weekStartDate: WEEK, plannedAt: '2026-05-23T09:00:00Z' },
      member,
    );
    expect(out.thoroughPlannedAt).toEqual(new Date('2026-05-23T09:00:00Z'));
  });

  it('rejects a member who is neither coordinator nor the group overseer', async () => {
    const slot = { serviceGroupId: 'A', thoroughPlannedAt: null } as any;
    const svc = svcWith(
      slotRepo(slot),
      {
        find: jest.fn(),
        findOne: jest.fn(async () => ({
          id: 'A',
          overseerPublisherId: 'pub-1',
        })),
      },
      { findOne: jest.fn(async () => ({ id: 'pub-OTHER' })) },
      { count: jest.fn(async () => 0) },
    );
    await expect(
      svc.planThorough(
        CONG,
        { weekStartDate: WEEK, plannedAt: '2026-05-23T09:00:00Z' },
        member,
      ),
    ).rejects.toThrow('Only the cleaning coordinator');
  });

  it('rejects a plannedAt outside the assignment week', async () => {
    const slot = { serviceGroupId: 'A', thoroughPlannedAt: null } as any;
    const svc = svcWith(slotRepo(slot), { find: jest.fn() });
    await expect(
      svc.planThorough(
        CONG,
        { weekStartDate: WEEK, plannedAt: '2026-06-05T18:00:00Z' },
        admin,
      ),
    ).rejects.toThrow('must fall inside');
  });

  it('clears the plan with plannedAt = null', async () => {
    const slot = {
      serviceGroupId: 'A',
      thoroughPlannedAt: new Date('2026-05-22T18:00:00Z'),
    } as any;
    const svc = svcWith(slotRepo(slot), { find: jest.fn() });
    const out = await svc.planThorough(
      CONG,
      { weekStartDate: WEEK, plannedAt: null },
      admin,
    );
    expect(out.thoroughPlannedAt).toBeNull();
  });
});

describe('CleaningService.planGeneral', () => {
  const WEEK = '2026-05-18';
  const admin = { id: 'u-admin', role: 'admin' } as any;
  const member = { id: 'u-member', role: 'publisher' } as any;

  function slotRepo(slot: any) {
    return {
      findOne: jest.fn(async () => slot),
      save: jest.fn(async (v: unknown) => v),
    } as any;
  }

  it('404s when the week has no general slot', async () => {
    const svc = svcWith(slotRepo(null), { find: jest.fn() });
    await expect(
      svc.planGeneral(CONG, { weekStartDate: WEEK, plannedAt: null }, admin),
    ).rejects.toThrow('No general cleaning');
  });

  it('allows an admin to set the datetime', async () => {
    const slot = { slotType: 'general', thoroughPlannedAt: null } as any;
    const svc = svcWith(slotRepo(slot), { find: jest.fn() });
    const out = await svc.planGeneral(
      CONG,
      { weekStartDate: WEEK, plannedAt: '2026-05-23T08:00:00Z' },
      admin,
    );
    expect(out.thoroughPlannedAt).toEqual(new Date('2026-05-23T08:00:00Z'));
  });

  it('allows the cleaning coordinator via responsibility', async () => {
    const slot = { slotType: 'general', thoroughPlannedAt: null } as any;
    const svc = svcWith(
      slotRepo(slot),
      { find: jest.fn() },
      { findOne: jest.fn(async () => null) },
      { count: jest.fn(async () => 1) },
    );
    const out = await svc.planGeneral(
      CONG,
      { weekStartDate: WEEK, plannedAt: '2026-05-23T08:00:00Z' },
      member,
    );
    expect(out.thoroughPlannedAt).toEqual(new Date('2026-05-23T08:00:00Z'));
  });

  it('rejects a regular member (group overseer rule does NOT apply)', async () => {
    const slot = { slotType: 'general', thoroughPlannedAt: null } as any;
    const svc = svcWith(
      slotRepo(slot),
      { find: jest.fn() },
      { findOne: jest.fn(async () => ({ id: 'pub-1' })) },
      { count: jest.fn(async () => 0) },
    );
    await expect(
      svc.planGeneral(
        CONG,
        { weekStartDate: WEEK, plannedAt: '2026-05-23T08:00:00Z' },
        member,
      ),
    ).rejects.toThrow('Only the cleaning coordinator');
  });

  it('rejects a datetime outside the week', async () => {
    const slot = { slotType: 'general', thoroughPlannedAt: null } as any;
    const svc = svcWith(slotRepo(slot), { find: jest.fn() });
    await expect(
      svc.planGeneral(
        CONG,
        { weekStartDate: WEEK, plannedAt: '2026-06-10T08:00:00Z' },
        admin,
      ),
    ).rejects.toThrow('must fall inside');
  });
});

describe('CleaningService.clearSlot', () => {
  it('deletes the slot row for the tenant/week/type', async () => {
    const repo = { delete: jest.fn(async () => ({ affected: 1 })) } as any;
    const svc = svcWith(repo, { find: jest.fn() });
    await svc.clearSlot(CONG, '2026-05-18', CleaningSlotType.THOROUGH);
    expect(repo.delete).toHaveBeenCalledWith({
      congregationId: CONG,
      weekStartDate: '2026-05-18',
      slotType: CleaningSlotType.THOROUGH,
    });
  });
});
