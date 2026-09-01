import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Congregation } from '../entities/congregation.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DutiesService } from './duties.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Duty } from '../entities/duty.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { DutyType } from '../common/enums/duty-type.enum';
import { EventType } from '../common/enums/event-type.enum';
import { CongregationClock } from '../common/congregation-clock.service';
import { clockStub } from '../common/testing/clock-stub';

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
  let specialEventRepo: { find: jest.Mock };
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
    specialEventRepo = { find: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CongregationClock, useValue: clockStub() },
        DutiesService,
        {
          provide: AuditLogService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logEvent: jest.fn(),
            logFieldsChanged: jest.fn(),
          },
        },
        { provide: getRepositoryToken(Duty), useValue: repo },
        { provide: getRepositoryToken(Assignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(Publisher), useValue: publisherRepo },
        { provide: getRepositoryToken(MeetingSettings), useValue: meetingRepo },
        {
          provide: getRepositoryToken(Congregation),
          useValue: congregationRepo,
        },
        {
          provide: getRepositoryToken(SpecialEvent),
          useValue: specialEventRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(DutiesService);
  });

  const gen = { weekStartDate: '2026-05-18', eventType: MIDWEEK };

  it('refuses to touch a meeting that has already taken place', async () => {
    // A Wednesday meeting in a week long past: the settings version in force
    // says midweek is day 3, so the duties froze the following midnight.
    // Once only: the other tests rely on the default empty settings.
    meetingRepo.find.mockResolvedValueOnce([
      { effectiveFrom: '2020-01-01', midweekDow: 3, weekendDow: 7 },
    ]);
    repo.findOne.mockResolvedValue({
      id: 'd1',
      congregationId: 'c1',
      weekStartDate: '2020-02-03',
      eventType: MIDWEEK,
      publisherId: null,
    });
    await expect(
      service.assign('c1', 'd1', { publisherId: 'p1' }),
    ).rejects.toThrow(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('generateWeek inserts 2 + micCount + 4 slots (mics from settings)', async () => {
    meetingRepo.find.mockResolvedValue([{ microphoneSlots: 3 }]);
    await service.generateWeek('c1', gen);
    expect(qb.insert).toHaveBeenCalled();
    const rows = qb.values.mock.calls[0][0] as Array<{ dutyType: DutyType }>;
    expect(rows).toHaveLength(2 + 3 + 4); // before + mics + after
    expect(rows.filter((r) => r.dutyType === DutyType.MICROPHONE)).toHaveLength(
      3,
    );
  });

  it('generateWeek defaults to 2 mics when there is no meeting settings', async () => {
    meetingRepo.find.mockResolvedValue([]);
    await service.generateWeek('c1', gen);
    const rows = qb.values.mock.calls[0][0] as unknown[];
    expect(rows).toHaveLength(2 + 2 + 4);
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

describe('DutiesService — a meeting an event took away has no duties', () => {
  // Nothing on the server said this until now: the app creates these by itself
  // when the schedule screen opens, and «на неделе конгресса обязанностей нет»
  // rested on one line in one client effect. Any other way in walked past it.
  // A week in the FUTURE on purpose: the past-freeze rule fires first, and a
  // past week would have every one of these refused for the wrong reason.
  const WEEK = '2027-04-05'; // Monday; midweek Thursday 8th, weekend Sunday 11th

  function build(events: any[]) {
    const qb: any = {
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
    const svc = new DutiesService(
      {
        logCreate: jest.fn(),
        logUpdate: jest.fn(),
        logEvent: jest.fn(),
      } as any,
      { createQueryBuilder: jest.fn(() => qb), findOne: jest.fn() } as any,
      { count: jest.fn().mockResolvedValue(0), findOne: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      {
        find: jest
          .fn()
          .mockResolvedValue([
            { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
          ]),
        save: jest.fn(),
      } as any,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ assignmentAutomationEnabled: false }),
      } as any,
      {
        find: jest.fn(async (opts: any) => {
          const where = opts.where;
          const wanted = Array.isArray(where)
            ? where.map((w: any) => w.type)
            : [where.type];
          if (!Array.isArray(where) && where.replacesMeeting) {
            return events.filter((e) => e.replacesMeeting);
          }
          return events.filter((e) => wanted.includes(e.type));
        }),
      } as any,
      clockStub(),
    );
    return { svc, qb };
  }

  it('refuses to generate them in a convention week', async () => {
    const { svc, qb } = build([
      {
        type: 'regional_convention',
        date: '2027-04-09',
        endDate: '2027-04-11',
      },
    ]);
    await expect(
      svc.generateWeek('c1', { weekStartDate: WEEK, eventType: MIDWEEK }),
    ).rejects.toThrow(ConflictException);
    expect(qb.insert).not.toHaveBeenCalled();
  });

  it('refuses for the meeting the Memorial took, and allows the other one', async () => {
    // Wednesday Memorial: the midweek meeting gives way, the weekend one is
    // held as usual.
    const events = [{ type: 'memorial', date: '2027-04-07', endDate: null }];
    const a = build(events);
    await expect(
      a.svc.generateWeek('c1', { weekStartDate: WEEK, eventType: MIDWEEK }),
    ).rejects.toThrow(ConflictException);

    const b = build(events);
    await b.svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'weekend' as any,
    });
    expect(b.qb.insert).toHaveBeenCalled();
  });

  it('refuses when an event flagged «в этот день обычной встречи нет» covers the day', async () => {
    const { svc, qb } = build([
      {
        type: 'special_talk',
        date: '2027-04-08',
        endDate: null,
        replacesMeeting: true,
      },
    ]);
    await expect(
      svc.generateWeek('c1', { weekStartDate: WEEK, eventType: MIDWEEK }),
    ).rejects.toThrow(ConflictException);
    expect(qb.insert).not.toHaveBeenCalled();
  });

  it('still generates them on an ordinary week', async () => {
    const { svc, qb } = build([]);
    await svc.generateWeek('c1', { weekStartDate: WEEK, eventType: MIDWEEK });
    expect(qb.insert).toHaveBeenCalled();
  });

  it('lets a congregation with no meeting settings yet create them', async () => {
    // A brand-new congregation has no settings, so no meeting appears in the
    // week's list either. Refusing there would stop it from setting itself up
    // — which is exactly what a first, too-broad version of this check did.
    const qb: any = {
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
    const svc = new DutiesService(
      {
        logCreate: jest.fn(),
        logUpdate: jest.fn(),
        logEvent: jest.fn(),
      } as any,
      { createQueryBuilder: jest.fn(() => qb), findOne: jest.fn() } as any,
      { count: jest.fn().mockResolvedValue(0), findOne: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue([]), save: jest.fn() } as any,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ assignmentAutomationEnabled: false }),
      } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      clockStub(),
    );
    await svc.generateWeek('c1', { weekStartDate: WEEK, eventType: MIDWEEK });
    expect(qb.insert).toHaveBeenCalled();
  });
});

describe('DutiesService.generateWeek — the Memorial evening', () => {
  /**
   * The Memorial is a third kind of meeting, so its duties are ordinary
   * duties. That is the whole point of naming it as a kind: the duties
   * section, its add and remove buttons, its counters and its printing all
   * come for nothing, and there is one mechanism to look after rather than
   * two.
   *
   * The list is CUSTOM duties, so the labels belong to the congregation and
   * can be renamed or removed without a release. A different hall — and the
   * Memorial is sometimes held in a rented room — wants different names.
   */
  const WEEK = '2027-03-22'; // Monday; the Memorial falls on it

  function build(memorial: unknown, previous: any[] = []) {
    const qb: any = {
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
    const svc = new DutiesService(
      {
        logCreate: jest.fn(),
        logUpdate: jest.fn(),
        logEvent: jest.fn(),
      } as any,
      {
        createQueryBuilder: jest.fn(() => qb),
        findOne: jest.fn(),
        // The Memorial's duties come from LAST YEAR'S; an empty list means
        // there was no last year, and the starting list in the code is used.
        find: jest.fn(async () => previous),
      } as any,
      { count: jest.fn().mockResolvedValue(0), findOne: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      {
        find: jest
          .fn()
          .mockResolvedValue([
            { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
          ]),
        save: jest.fn(),
      } as any,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ assignmentAutomationEnabled: false }),
      } as any,
      {
        find: jest.fn(async (opts: any) => {
          const where = opts.where;
          if (!Array.isArray(where) && where.replacesMeeting) return [];
          const wanted = Array.isArray(where)
            ? where.map((w: any) => w.type)
            : [where.type];
          return wanted.includes('memorial') && memorial ? [memorial] : [];
        }),
      } as any,
      clockStub(),
    );
    return { svc, qb };
  }

  const memorialEvent = {
    id: 'ev-1',
    type: 'memorial',
    date: '2027-03-22',
    endDate: null,
  };

  it('lays out the evening’s own places, not the ordinary eight', async () => {
    const { svc, qb } = build(memorialEvent);

    await svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'memorial' as any,
    });

    const rows = (qb.values as jest.Mock).mock.calls[0][0];
    const labels = rows.map((r: any) => r.customLabel);
    expect(labels).toContain('Главный зал');
    expect(labels).toContain('Левый ряд');
    // Nothing from the ordinary meeting's list.
    expect(rows.every((r: any) => r.dutyType === 'custom')).toBe(true);
  });

  it('gives a place with several brothers that many rows', async () => {
    const { svc, qb } = build(memorialEvent);
    await svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'memorial' as any,
    });
    const rows = (qb.values as jest.Mock).mock.calls[0][0];
    expect(rows.filter((r: any) => r.customLabel === 'Стоянка')).toHaveLength(
      3,
    );
    expect(rows.filter((r: any) => r.customLabel === 'Левый ряд')).toHaveLength(
      2,
    );
  });

  it('puts the reminder on every row of the place it belongs to', async () => {
    const { svc, qb } = build(memorialEvent);
    await svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'memorial' as any,
    });
    const rows = (qb.values as jest.Mock).mock.calls[0][0];
    const parking = rows.filter((r: any) => r.customLabel === 'Стоянка');
    expect(parking.map((r: any) => r.notes)).toEqual([
      'Светоотражающие жилетки',
      'Светоотражающие жилетки',
      'Светоотражающие жилетки',
    ]);
  });

  it('gives every row its own slot, so none collides with another', async () => {
    const { svc, qb } = build(memorialEvent);
    await svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'memorial' as any,
    });
    const rows = (qb.values as jest.Mock).mock.calls[0][0];
    const slots = rows.map((r: any) => r.slotIndex);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('refuses on a week that holds no Memorial', async () => {
    const { svc, qb } = build(null);
    await expect(
      svc.generateWeek('c1', {
        weekStartDate: WEEK,
        eventType: 'memorial' as any,
      }),
    ).rejects.toThrow(ConflictException);
    expect(qb.insert).not.toHaveBeenCalled();
  });

  // ---- перенос с прошлогодней Вечери ----

  /**
   * The congregation renames places for its own hall, adds one and drops
   * another. Without this all of that would be undone every spring and done
   * again by hand — the same reason the programme is carried from last year.
   * Labels, counts and notes travel; PEOPLE do not.
   */

  it('takes the places from last year, keeping how many stand at each', async () => {
    const lastYear = [
      {
        weekStartDate: '2026-04-01',
        customLabel: 'Парковка',
        notes: 'Жилетки',
        slotIndex: 0,
        publisherId: 'p1',
      },
      {
        weekStartDate: '2026-04-01',
        customLabel: 'Парковка',
        notes: 'Жилетки',
        slotIndex: 1,
        publisherId: 'p2',
      },
      {
        weekStartDate: '2026-04-01',
        customLabel: 'Вход',
        notes: null,
        slotIndex: 2,
        publisherId: 'p3',
      },
    ];
    const { svc, qb } = build(memorialEvent, lastYear);

    await svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'memorial' as any,
    });

    const rows = (qb.values as jest.Mock).mock.calls[0][0];
    expect(rows.map((r: any) => r.customLabel)).toEqual([
      'Парковка',
      'Парковка',
      'Вход',
    ]);
    expect(rows.filter((r: any) => r.customLabel === 'Парковка')[0].notes).toBe(
      'Жилетки',
    );
    // Nobody is carried: who stands where is decided afresh.
    expect(rows.every((r: any) => r.publisherId === null)).toBe(true);
  });

  it('ignores anything older than the most recent Memorial', async () => {
    const rows = [
      {
        weekStartDate: '2026-04-01',
        customLabel: 'Новое',
        notes: null,
        slotIndex: 0,
      },
      {
        weekStartDate: '2025-04-01',
        customLabel: 'Старое',
        notes: null,
        slotIndex: 0,
      },
    ];
    const { svc, qb } = build(memorialEvent, rows);
    await svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'memorial' as any,
    });
    const made = (qb.values as jest.Mock).mock.calls[0][0];
    expect(made.map((r: any) => r.customLabel)).toEqual(['Новое']);
  });

  it('falls back to the starting list when there is no earlier Memorial', async () => {
    const { svc, qb } = build(memorialEvent, []);
    await svc.generateWeek('c1', {
      weekStartDate: WEEK,
      eventType: 'memorial' as any,
    });
    const made = (qb.values as jest.Mock).mock.calls[0][0];
    expect(made.map((r: any) => r.customLabel)).toContain('Главный зал');
  });
});

describe('DutiesService — a PLACE is renamed and removed whole', () => {
  /**
   * «Стоянка» is three rows sharing a label. Renaming one would split the
   * group in two and the screen would show two places where the congregation
   * has one; removing one only takes a person off the place. So both act on
   * every row of the place at once.
   *
   * OWN places only. A predefined duty takes its name from the translations —
   * «Сцена» in Russian, «Bühne» in German — and writing over it would break
   * the language for everybody else.
   */
  const FUTURE_WEEK = '2099-04-06';

  function make(duty: Record<string, unknown>, rows: unknown[]) {
    const saved: unknown[] = [];
    const removed: unknown[] = [];
    const audit = {
      logCreate: jest.fn(),
      logUpdate: jest.fn(),
      logEvent: jest.fn(),
    };
    const repo = {
      findOne: jest.fn(async () => duty),
      find: jest.fn(async () => rows),
      save: jest.fn(async (x: unknown) => {
        saved.push(x);
        return x;
      }),
      remove: jest.fn(async (x: unknown) => {
        removed.push(x);
        return x;
      }),
    } as any;
    const svc = new DutiesService(
      audit as any,
      repo,
      { count: jest.fn().mockResolvedValue(0), findOne: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue([]), save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue({}) } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      clockStub(),
    );
    return { svc, repo, audit, saved, removed };
  }

  const parking = (i: number) => ({
    id: `p${i}`,
    congregationId: 'c1',
    weekStartDate: FUTURE_WEEK,
    eventType: 'memorial',
    dutyType: 'custom',
    customLabel: 'Стоянка',
    slotIndex: i,
    notes: null,
    publisherId: null,
  });

  it('renames every row of the place, not just the one tapped', async () => {
    const rows = [parking(0), parking(1), parking(2)];
    const { svc, saved } = make(rows[1], rows);

    await svc.renamePlace('c1', 'p1', 'Парковка');

    expect((saved[0] as any[]).map((r) => r.customLabel)).toEqual([
      'Парковка',
      'Парковка',
      'Парковка',
    ]);
  });

  it('removes every row of the place at once', async () => {
    const rows = [parking(0), parking(1), parking(2)];
    const { svc, removed } = make(rows[0], rows);

    await svc.removePlace('c1', 'p0');

    expect((removed[0] as unknown[]).length).toBe(3);
  });

  it('refuses to rename a duty whose name comes from the translations', async () => {
    const stage = { ...parking(0), dutyType: 'stage', customLabel: null };
    const { svc, saved } = make(stage, [stage]);
    await expect(svc.renamePlace('c1', 'p0', 'Что угодно')).rejects.toThrow(
      ConflictException,
    );
    expect(saved).toHaveLength(0);
  });

  it('refuses to remove a predefined duty as a place', async () => {
    const mic = { ...parking(0), dutyType: 'microphone', customLabel: null };
    const { svc, removed } = make(mic, [mic]);
    await expect(svc.removePlace('c1', 'p0')).rejects.toThrow(
      ConflictException,
    );
    expect(removed).toHaveLength(0);
  });

  it('writes the rename to the journal', async () => {
    const rows = [parking(0)];
    const { svc, audit } = make(rows[0], rows);
    await svc.renamePlace('c1', 'p0', 'Парковка');
    expect(audit.logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'duty',
        before: { customLabel: 'Стоянка' },
        after: { customLabel: 'Парковка' },
      }),
    );
  });
});
