import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Congregation } from '../entities/congregation.entity';
import { NotFoundException } from '@nestjs/common';
import { DutiesService } from './duties.service';
import { Duty } from '../entities/duty.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { DutyType } from '../common/enums/duty-type.enum';
import { EventType } from '../common/enums/event-type.enum';

const MIDWEEK = 'midweek' as EventType;

describe('DutiesService', () => {
  let service: DutiesService;
  let repo: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let assignmentRepo: { count: jest.Mock; findOne: jest.Mock };
  let congregationRepo: { findOne: jest.Mock };
  let publisherRepo: { findOne: jest.Mock };
  let meetingRepo: { find: jest.Mock; save: jest.Mock };
  let qb: Record<string, jest.Mock>;

  beforeEach(async () => {
    qb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue({ max: null }),
    };
    repo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: x.id ?? 'd1', ...x })),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    assignmentRepo = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };
    congregationRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ assignmentAutomationEnabled: false }),
    };
    publisherRepo = { findOne: jest.fn() };
    meetingRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((x) => Promise.resolve(x)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DutiesService,
        { provide: getRepositoryToken(Duty), useValue: repo },
        { provide: getRepositoryToken(Assignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(Publisher), useValue: publisherRepo },
        { provide: getRepositoryToken(MeetingSettings), useValue: meetingRepo },
        {
          provide: getRepositoryToken(Congregation),
          useValue: congregationRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(DutiesService);
  });

  const gen = { weekStartDate: '2026-05-18', eventType: MIDWEEK };

  it('generateWeek inserts 2 + micCount + 5 slots (mics from settings)', async () => {
    meetingRepo.find.mockResolvedValue([{ microphoneSlots: 3 }]);
    await service.generateWeek('c1', gen);
    expect(qb.insert).toHaveBeenCalled();
    const rows = qb.values.mock.calls[0][0] as Array<{ dutyType: DutyType }>;
    expect(rows).toHaveLength(2 + 3 + 5); // before + mics + after
    expect(rows.filter((r) => r.dutyType === DutyType.MICROPHONE)).toHaveLength(
      3,
    );
  });

  it('generateWeek defaults to 2 mics when there is no meeting settings', async () => {
    meetingRepo.find.mockResolvedValue([]);
    await service.generateWeek('c1', gen);
    const rows = qb.values.mock.calls[0][0] as unknown[];
    expect(rows).toHaveLength(2 + 2 + 5);
  });

  const duty: Duty = {
    id: 'd1',
    congregationId: 'c1',
    weekStartDate: '2026-05-18',
    eventType: MIDWEEK,
    dutyType: DutyType.MICROPHONE,
    slotIndex: 0,
    customLabel: null,
    publisherId: null,
    publisher: null,
    notes: null,
  } as unknown as Duty;

  it('assign clears the slot and returns no warnings when publisherId is null', async () => {
    repo.findOne.mockResolvedValue({ ...duty });
    const res = await service.assign('c1', 'd1', { publisherId: null });
    expect(res.duty.publisherId).toBeNull();
    expect(res.warnings).toEqual([]);
  });

  it('assign flags capability_off when the duty_<type> capability is not set', async () => {
    repo.findOne.mockResolvedValue({ ...duty });
    publisherRepo.findOne.mockResolvedValue({ id: 'p1', capabilities: {} });
    const res = await service.assign('c1', 'd1', { publisherId: 'p1' });
    expect(res.warnings).toContain('capability_off');
  });

  it('assign flags already_on_duty and has_program_part', async () => {
    repo.findOne.mockResolvedValue({ ...duty });
    repo.count.mockResolvedValue(1); // another duty same meeting
    assignmentRepo.count.mockResolvedValue(1); // program part same meeting
    publisherRepo.findOne.mockResolvedValue({
      id: 'p1',
      capabilities: { duty_microphone: true },
    });
    const res = await service.assign('c1', 'd1', { publisherId: 'p1' });
    expect(res.warnings).toEqual(
      expect.arrayContaining(['already_on_duty', 'has_program_part']),
    );
    expect(res.warnings).not.toContain('capability_off');
  });

  it('custom duties skip the capability check', async () => {
    const custom = {
      ...duty,
      dutyType: DutyType.CUSTOM,
      customLabel: 'Greeter',
    };
    repo.findOne.mockResolvedValue(custom);
    const res = await service.assign('c1', 'd1', { publisherId: 'p1' });
    expect(res.warnings).not.toContain('capability_off');
    expect(publisherRepo.findOne).not.toHaveBeenCalled();
  });

  it('createCustom uses the next slotIndex after the current max', async () => {
    qb.getRawOne.mockResolvedValue({ max: 1 });
    const res = await service.createCustom('c1', {
      weekStartDate: '2026-05-18',
      eventType: MIDWEEK,
      customLabel: 'Door',
    });
    expect(res.duty.slotIndex).toBe(2);
    expect(res.duty.dutyType).toBe(DutyType.CUSTOM);
  });

  it('setMicrophoneSlots updates the effective meeting-settings version', async () => {
    meetingRepo.find.mockResolvedValue([{ id: 'm1', microphoneSlots: 2 }]);
    const res = await service.setMicrophoneSlots('c1', 4);
    expect(res.microphoneSlots).toBe(4);
    expect(meetingRepo.save).toHaveBeenCalled();
  });

  it('setMicrophoneSlots throws when there is no meeting settings', async () => {
    meetingRepo.find.mockResolvedValue([]);
    await expect(service.setMicrophoneSlots('c1', 4)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('remove throws when the duty does not exist', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.remove('c1', 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('reconcileTreasuresMic', () => {
    const W = '2026-07-06';
    beforeEach(() => {
      congregationRepo.findOne.mockResolvedValue({
        assignmentAutomationEnabled: true,
      });
    });

    it('fills mic slot 0 from the Treasures-talk speaker', async () => {
      repo.findOne.mockResolvedValue({ id: 'mic0', publisherId: null });
      assignmentRepo.findOne.mockResolvedValue({ publisherId: 'spk' });
      publisherRepo.findOne.mockResolvedValue({
        id: 'spk',
        displayName: 'Bro',
        capabilities: { duty_microphone: true },
      });
      const warnings = await service.reconcileTreasuresMic('c1', W, MIDWEEK);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mic0', publisherId: 'spk' }),
      );
      expect(warnings).toEqual([]);
    });

    it('leaves a manually-taken mic and warns mic_taken', async () => {
      repo.findOne.mockResolvedValue({ id: 'mic0', publisherId: 'other' });
      assignmentRepo.findOne.mockResolvedValue({ publisherId: 'spk' });
      publisherRepo.findOne.mockResolvedValue({
        id: 'other',
        displayName: 'Other',
      });
      const warnings = await service.reconcileTreasuresMic('c1', W, MIDWEEK);
      expect(repo.save).not.toHaveBeenCalled();
      expect(warnings).toEqual([{ code: 'mic_taken', publisherName: 'Other' }]);
    });

    it('fills but flags a missing mic capability', async () => {
      repo.findOne.mockResolvedValue({ id: 'mic0', publisherId: null });
      assignmentRepo.findOne.mockResolvedValue({ publisherId: 'spk' });
      publisherRepo.findOne.mockResolvedValue({
        id: 'spk',
        displayName: 'Bro',
        capabilities: {},
      });
      const warnings = await service.reconcileTreasuresMic('c1', W, MIDWEEK);
      expect(repo.save).toHaveBeenCalled();
      expect(warnings).toEqual([
        { code: 'mic_capability_off', publisherName: 'Bro' },
      ]);
    });

    it('is a no-op when automation is disabled', async () => {
      congregationRepo.findOne.mockResolvedValue({
        assignmentAutomationEnabled: false,
      });
      repo.findOne.mockResolvedValue({ id: 'mic0', publisherId: null });
      const warnings = await service.reconcileTreasuresMic('c1', W, MIDWEEK);
      expect(repo.save).not.toHaveBeenCalled();
      expect(warnings).toEqual([]);
    });
  });
});
