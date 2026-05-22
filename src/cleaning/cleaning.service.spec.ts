import { CleaningService } from './cleaning.service';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';

const CONG = '11111111-1111-1111-1111-111111111111';
const groups = [
  { id: 'A', name: 'Group A' },
  { id: 'B', name: 'Group B' },
  { id: 'C', name: 'Group C' },
];

function svcWith(repo: any, groupRepo: any) {
  return new CleaningService(repo, groupRepo);
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
