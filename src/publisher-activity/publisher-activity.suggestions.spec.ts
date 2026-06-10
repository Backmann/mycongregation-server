import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PublisherActivityService } from './publisher-activity.service';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';

describe('PublisherActivityService.getSuggestions', () => {
  let service: PublisherActivityService;
  let assignmentRepo: { find: jest.Mock };

  beforeEach(async () => {
    assignmentRepo = { find: jest.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublisherActivityService,
        { provide: getRepositoryToken(Assignment), useValue: assignmentRepo },
        {
          provide: getRepositoryToken(Duty),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    service = moduleRef.get(PublisherActivityService);
  });

  it('returns [] for empty part keys without querying', async () => {
    const res = await service.getSuggestions('c1', '2026-06-08', []);
    expect(res).toEqual([]);
    expect(assignmentRepo.find).not.toHaveBeenCalled();
  });

  it('returns [] when there is no matching history', async () => {
    const res = await service.getSuggestions('c1', '2026-06-08', ['k']);
    expect(res).toEqual([]);
  });

  it('aggregates last primary/assistant dates, skipping the target week, cancelled rows and other parts', async () => {
    assignmentRepo.find.mockResolvedValue([
      {
        partKey: 'apply_yourself_1',
        status: 'confirmed',
        weekStartDate: '2026-05-11',
        publisherId: 'p1',
        assistantPublisherId: 'a1',
      },
      {
        partKey: 'apply_yourself_1',
        status: 'confirmed',
        weekStartDate: '2026-05-25',
        publisherId: 'p1',
        assistantPublisherId: 'a2',
      },
      {
        partKey: 'apply_yourself_1',
        status: 'cancelled',
        weekStartDate: '2026-06-01',
        publisherId: 'p1',
        assistantPublisherId: null,
      },
      {
        // Target week itself must not count as "last did".
        partKey: 'apply_yourself_1',
        status: 'confirmed',
        weekStartDate: '2026-06-08',
        publisherId: 'p1',
        assistantPublisherId: null,
      },
      {
        partKey: 'other_part',
        status: 'confirmed',
        weekStartDate: '2026-06-01',
        publisherId: 'p1',
        assistantPublisherId: null,
      },
    ]);

    const res = await service.getSuggestions('c1', '2026-06-08', [
      'apply_yourself_1',
    ]);

    const p1 = res.find((r) => r.publisherId === 'p1');
    expect(p1).toBeDefined();
    expect(p1!.lastPrimaryAt).toBe('2026-05-25');
    expect(p1!.recentAssistants).toEqual([
      { publisherId: 'a2', weekStartDate: '2026-05-25' },
      { publisherId: 'a1', weekStartDate: '2026-05-11' },
    ]);

    const a1 = res.find((r) => r.publisherId === 'a1');
    expect(a1).toBeDefined();
    expect(a1!.lastAssistantAt).toBe('2026-05-11');
    expect(a1!.lastPrimaryAt).toBeNull();
  });

  it('dedupes repeated assistants keeping the most recent pairing, max 3', async () => {
    assignmentRepo.find.mockResolvedValue([
      {
        partKey: 'k',
        status: 'confirmed',
        weekStartDate: '2026-03-02',
        publisherId: 'p1',
        assistantPublisherId: 'a1',
      },
      {
        partKey: 'k',
        status: 'confirmed',
        weekStartDate: '2026-04-06',
        publisherId: 'p1',
        assistantPublisherId: 'a1',
      },
      {
        partKey: 'k',
        status: 'confirmed',
        weekStartDate: '2026-04-20',
        publisherId: 'p1',
        assistantPublisherId: 'a2',
      },
      {
        partKey: 'k',
        status: 'confirmed',
        weekStartDate: '2026-05-04',
        publisherId: 'p1',
        assistantPublisherId: 'a3',
      },
      {
        partKey: 'k',
        status: 'confirmed',
        weekStartDate: '2026-05-18',
        publisherId: 'p1',
        assistantPublisherId: 'a4',
      },
    ]);

    const res = await service.getSuggestions('c1', '2026-06-08', ['k']);
    const p1 = res.find((r) => r.publisherId === 'p1');
    expect(p1!.recentAssistants).toEqual([
      { publisherId: 'a4', weekStartDate: '2026-05-18' },
      { publisherId: 'a3', weekStartDate: '2026-05-04' },
      { publisherId: 'a2', weekStartDate: '2026-04-20' },
    ]);
  });
});
