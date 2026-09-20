import { BadRequestException } from '@nestjs/common';
import { CleaningService } from './cleaning.service';

/**
 * The range door, pinned. What it must do is narrow — one query, rows only —
 * and what it must NOT do is the interesting half: no round-robin hint, and
 * no silent acceptance of a backwards span.
 */

function build() {
  const calls: Record<string, unknown>[] = [];
  const repo = {
    find: (q: Record<string, unknown>) => {
      calls.push(q);
      return Promise.resolve([{ weekStartDate: '2026-09-14' }]);
    },
    findOne: jest.fn(),
  };
  const groupRepo = { find: jest.fn().mockResolvedValue([]) };
  const service = new CleaningService(
    repo as never,
    groupRepo as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, repo, groupRepo, calls };
}

describe('CleaningService.getRange', () => {
  it('reads the whole span in ONE query', async () => {
    const { service, calls } = build();
    await service.getRange('c1', '2026-09-07', '2026-09-28');
    expect(calls).toHaveLength(1);
  });

  it('does not compute the round-robin hint — that costs a query per week', async () => {
    const { service, groupRepo } = build();
    await service.getRange('c1', '2026-09-07', '2026-09-28');
    // Fetching the groups is the first thing the hint does; it must not happen.
    expect(groupRepo.find).not.toHaveBeenCalled();
  });

  it('refuses a span that ends before it starts', async () => {
    const { service } = build();
    await expect(
      service.getRange('c1', '2026-09-28', '2026-09-07'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a span of no width at all', async () => {
    // weekEnd is exclusive, so start === end asks for nothing; saying so is
    // kinder than returning an empty list that looks like «nothing assigned».
    const { service } = build();
    await expect(
      service.getRange('c1', '2026-09-07', '2026-09-07'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('orders by week, then by slot', async () => {
    const { service, calls } = build();
    await service.getRange('c1', '2026-09-07', '2026-09-28');
    expect(calls[0].order).toEqual({ weekStartDate: 'ASC', slotType: 'ASC' });
  });
});
