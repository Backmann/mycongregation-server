import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PublisherActivityService } from './publisher-activity.service';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';

describe('PublisherActivityService', () => {
  let service: PublisherActivityService;
  let assignmentRepo: { find: jest.Mock };
  let dutyRepo: { find: jest.Mock };

  beforeEach(async () => {
    assignmentRepo = { find: jest.fn().mockResolvedValue([]) };
    dutyRepo = { find: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublisherActivityService,
        { provide: getRepositoryToken(Assignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(Duty), useValue: dutyRepo },
      ],
    }).compile();
    service = moduleRef.get(PublisherActivityService);
  });

  it('returns an empty list when there is no activity', async () => {
    const res = await service.getActivity('c1', '2026-05-18', 4);
    expect(res).toEqual([]);
  });

  it('groups parts (primary + assistant) and duties by publisher', async () => {
    assignmentRepo.find.mockResolvedValue([
      {
        weekStartDate: '2026-05-18',
        eventType: 'midweek',
        partKey: 'bible_reading',
        partTitle: 'X',
        publisherId: 'p1',
        assistantPublisherId: null,
      },
      {
        weekStartDate: '2026-05-18',
        eventType: 'midweek',
        partKey: 'apply_yourself_1',
        partTitle: 'Y',
        publisherId: 'p2',
        assistantPublisherId: 'p1',
      },
    ]);
    dutyRepo.find.mockResolvedValue([
      {
        weekStartDate: '2026-05-11',
        eventType: 'midweek',
        dutyType: 'microphone',
        slotIndex: 0,
        customLabel: null,
        publisherId: 'p1',
      },
    ]);

    const res = await service.getActivity('c1', '2026-05-18', 4);
    const p1 = res.find((r) => r.publisherId === 'p1');
    const p2 = res.find((r) => r.publisherId === 'p2');
    expect(p1?.items).toHaveLength(3); // primary part + assistant part + duty
    expect(p2?.items).toHaveLength(1);
    expect(p1?.items.some((i) => i.kind === 'duty')).toBe(true);
    expect(p1?.items.some((i) => i.role === 'assistant')).toBe(true);
  });

  it('queries from weekStart minus weeks*7 days', async () => {
    await service.getActivity('c1', '2026-05-18', 4);
    const where = assignmentRepo.find.mock.calls[0][0].where;
    // Between(from, to) FindOperator exposes its bounds via .value
    const [from, to] = (where.weekStartDate as { value: [string, string] })
      .value;
    expect(from).toBe('2026-04-20');
    expect(to).toBe('2026-05-18');
  });
});
