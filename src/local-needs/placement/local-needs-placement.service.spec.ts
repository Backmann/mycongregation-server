import 'reflect-metadata';
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { BadRequestException } from '@nestjs/common';
import { LocalNeedsPlacementService } from './local-needs-placement.service';

/**
 * «Поставить на неделю» in its three ways — instead of the «Местные
 * потребности» part, instead of another «В жизни христианина» part, or as one
 * more part — always through the assignments' own door.
 */
describe('LocalNeedsPlacementService', () => {
  let topics: any;
  let parts: any;
  let assignments: any;
  let localNeeds: any;
  let service: LocalNeedsPlacementService;
  let week: any[];

  const admin = { id: 'u', role: 'admin', congregationId: 'c' } as any;
  const part = (over: Record<string, any>) => ({
    id: 'p',
    partKey: 'living_christians_1',
    partOrder: 10,
    publisherId: null,
    status: 'published',
    ...over,
  });

  beforeEach(() => {
    week = [
      part({ id: 'gems', partKey: 'treasures_gems', partOrder: 2 }),
      part({ id: 'lc1', partKey: 'living_christians_1', partOrder: 8 }),
      part({
        id: 'lc2',
        partKey: 'living_christians_2',
        partOrder: 9,
        publisherId: 'pub-x',
      }),
      part({ id: 'cbs', partKey: 'cbs_conductor', partOrder: 10 }),
      part({ id: 'end', partKey: 'closing_prayer', partOrder: 11 }),
    ];
    topics = {
      findOne: jest.fn().mockResolvedValue({
        id: 't',
        title: 'Чистота в зале',
        speakerPublisherId: 'pub-s',
      }),
    };
    parts = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => week),
      })),
    };
    assignments = {
      update: jest.fn(),
      create: jest.fn(async (_t: string, dto: any) => ({ id: 'new', ...dto })),
    };
    localNeeds = {
      assertCanManage: jest.fn(),
      bindToPart: jest.fn(async () => ({ id: 't' })),
    };
    service = new LocalNeedsPlacementService(
      topics,
      parts,
      assignments,
      localNeeds,
    );
  });

  it('puts the title on the chosen part, and the intended brother when it has none', async () => {
    await service.place(
      'c',
      't',
      { weekStartDate: '2026-11-11', assignmentId: 'lc1' },
      admin,
    );
    expect(assignments.update).toHaveBeenCalledWith(
      'c',
      'lc1',
      { partTitle: 'Чистота в зале', publisherId: 'pub-s' },
      admin,
    );
    expect(localNeeds.bindToPart).toHaveBeenCalledWith(
      'c',
      't',
      '2026-11-09',
      'lc1',
    );
  });

  it('leaves a brother already on the part where he is', async () => {
    await service.place(
      'c',
      't',
      { weekStartDate: '2026-11-09', assignmentId: 'lc2' },
      admin,
    );
    expect(assignments.update).toHaveBeenCalledWith(
      'c',
      'lc2',
      { partTitle: 'Чистота в зале' },
      admin,
    );
  });

  it('adds one more part after the last «В жизни христианина» part', async () => {
    await service.place(
      'c',
      't',
      { weekStartDate: '2026-11-09', durationMin: 10 },
      admin,
    );
    // The parts behind it move one place down, the last first.
    expect(
      assignments.update.mock.calls.map((c: any[]) => [c[1], c[2].partOrder]),
    ).toEqual([
      ['end', 12],
      ['cbs', 11],
    ]);
    expect(assignments.create).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({
        partKey: 'living_christians_extra',
        partOrder: 10,
        partTitle: 'Чистота в зале',
        partDurationMin: 10,
        status: 'published',
        publisherId: 'pub-s',
      }),
      admin,
    );
    expect(localNeeds.bindToPart).toHaveBeenCalledWith(
      'c',
      't',
      '2026-11-09',
      'new',
    );
  });

  it('refuses a part that is not «В жизни христианина»', async () => {
    await expect(
      service.place(
        'c',
        't',
        { weekStartDate: '2026-11-09', assignmentId: 'gems' },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assignments.update).not.toHaveBeenCalled();
  });

  it('refuses a week whose programme is not there yet', async () => {
    week = [];
    await expect(
      service.place('c', 't', { weekStartDate: '2027-03-01' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('asks who may manage before anything else', async () => {
    localNeeds.assertCanManage.mockRejectedValue(new Error('no'));
    await expect(
      service.place('c', 't', { weekStartDate: '2026-11-09' }, admin),
    ).rejects.toThrow('no');
    expect(topics.findOne).not.toHaveBeenCalled();
  });

  it('gives a new part the minutes the topic is meant for, unless asked otherwise', async () => {
    topics.findOne.mockResolvedValue({
      id: 't',
      title: 'Чистота в зале',
      speakerPublisherId: null,
      durationMin: 7,
    });
    await service.place('c', 't', { weekStartDate: '2026-11-09' }, admin);
    expect(assignments.create.mock.calls[0][1].partDurationMin).toBe(7);
    await service.place(
      'c',
      't',
      { weekStartDate: '2026-11-09', durationMin: 5 },
      admin,
    );
    expect(assignments.create.mock.calls[1][1].partDurationMin).toBe(5);
  });
});
