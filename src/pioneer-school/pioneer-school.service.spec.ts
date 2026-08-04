import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PioneerSchoolService } from './pioneer-school.service';
import { UserRole } from '../common/enums/user-role.enum';
import { DutyType } from '../common/enums/duty-type.enum';
import { EventType } from '../common/enums/event-type.enum';

describe('PioneerSchoolService', () => {
  let schools: any;
  let days: any;
  let duties: any;
  let helpers: any;
  let absences: any;
  let meetingAttendance: any;
  let meetingDuties: any;
  let audit: any;
  let service: PioneerSchoolService;

  const admin = {
    id: 'u-admin',
    role: UserRole.ADMIN,
    congregationId: 'cong-1',
  } as any;
  const elder = {
    id: 'u-elder',
    role: UserRole.ELDER,
    congregationId: 'cong-1',
  } as any;
  const publisher = {
    id: 'u-pub',
    role: UserRole.PUBLISHER,
    congregationId: 'cong-1',
  } as any;

  const school = (over: Record<string, any> = {}) => ({
    id: 'school-1',
    congregationId: 'cong-1',
    title: 'Школа пионерского служения',
    startDate: '2026-11-23',
    endDate: '2026-11-29',
    hallName: 'Зал Царства Ahlen',
    hallAddress: null,
    startTime: '09:00',
    endTime: null,
    microphoneSlots: 2,
    notes: null,
    ...over,
  });

  /** A repository stub that remembers what was saved. */
  const repo = (rows: any[] = []) => {
    const saved: any[] = [];
    return {
      rows,
      saved,
      find: jest.fn(async () => rows),
      findOne: jest.fn(async () => rows[0] ?? null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => {
        saved.push(x);
        return { id: x.id ?? `new-${saved.length}`, ...x };
      }),
      delete: jest.fn(async () => undefined),
      softDelete: jest.fn(async () => undefined),
    };
  };

  const build = () => {
    service = new PioneerSchoolService(
      schools,
      days,
      duties,
      helpers,
      absences,
      meetingAttendance,
      meetingDuties,
      audit,
    );
  };

  beforeEach(() => {
    schools = repo([school()]);
    days = repo([]);
    duties = repo([]);
    helpers = repo([]);
    absences = repo([]);
    meetingAttendance = { pendingForWeek: jest.fn(async () => []) };
    meetingDuties = repo([]);
    audit = { logCreate: jest.fn(), logUpdate: jest.fn(), logEvent: jest.fn() };
    build();
  });

  describe('who may do what', () => {
    it('lets an elder read the schedule', async () => {
      await expect(service.findAll('cong-1', elder)).resolves.toBeDefined();
    });

    it('lets only an administrator change it', async () => {
      await expect(
        service.update('cong-1', 'school-1', { title: 'X' }, elder),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('keeps it away from an ordinary publisher entirely', async () => {
      await expect(service.findAll('cong-1', publisher)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('the days a school implies', () => {
    it('makes a day for every date in the range, ends included', async () => {
      await service.create(
        'cong-1',
        {
          title: 'Школа',
          startDate: '2026-11-23',
          endDate: '2026-11-29',
        } as any,
        admin,
      );

      const dates = days.save.mock.calls.map((c: any[]) => c[0].date);
      expect(dates).toEqual([
        '2026-11-23',
        '2026-11-24',
        '2026-11-25',
        '2026-11-26',
        '2026-11-27',
        '2026-11-28',
        '2026-11-29',
      ]);
    });

    it('refuses a range that ends before it starts', async () => {
      await expect(
        service.create(
          'cong-1',
          {
            title: 'Школа',
            startDate: '2026-11-29',
            endDate: '2026-11-23',
          } as any,
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('leaves the days that survive a shortened range alone', async () => {
      // Moving the end of a school by a day must not quietly empty the other
      // five: only the day that fell outside goes.
      days.find = jest.fn(async () => [
        { id: 'd1', date: '2026-11-23', schoolId: 'school-1' },
        { id: 'd2', date: '2026-11-24', schoolId: 'school-1' },
        { id: 'd3', date: '2026-11-25', schoolId: 'school-1' },
      ]);
      schools.findOne = jest.fn(async () => school({ endDate: '2026-11-24' }));

      await service.update(
        'cong-1',
        'school-1',
        { endDate: '2026-11-24' },
        admin,
      );

      // Exactly one day removed, and it is the one that fell outside.
      expect(days.delete).toHaveBeenCalledTimes(1);
      const where = days.delete.mock.calls[0][0];
      expect(where.id.value).toEqual(['d3']);
    });
  });

  describe('the roles of a day', () => {
    it('gives a day audio-video, the microphones and ventilation', async () => {
      await service.create(
        'cong-1',
        {
          title: 'Школа',
          startDate: '2026-11-23',
          endDate: '2026-11-23',
        } as any,
        admin,
      );

      const made = duties.save.mock.calls.map((c: any[]) => [
        c[0].dutyType,
        c[0].slotIndex,
      ]);
      expect(made).toEqual([
        [DutyType.AV, 0],
        [DutyType.MICROPHONE, 0],
        [DutyType.MICROPHONE, 1],
        [DutyType.VENTILATION, 0],
      ]);
    });

    it('follows the school when it says three microphones', async () => {
      await service.create(
        'cong-1',
        {
          title: 'Школа',
          startDate: '2026-11-23',
          endDate: '2026-11-23',
          microphoneSlots: 3,
        } as any,
        admin,
      );

      const mics = duties.save.mock.calls.filter(
        (c: any[]) => c[0].dutyType === DutyType.MICROPHONE,
      );
      expect(mics).toHaveLength(3);
    });

    it('refuses to remove a standing role, which reconciliation would restore', async () => {
      duties.findOne = jest.fn(async () => ({
        id: 'duty-1',
        dayId: 'd1',
        dutyType: DutyType.AV,
        congregationId: 'cong-1',
      }));
      // The duty must also belong to THIS school — checked before the kind.
      days.findOne = jest.fn(async () => ({ id: 'd1', schoolId: 'school-1' }));

      await expect(
        service.removeCustomDuty('cong-1', 'school-1', 'duty-1', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('an absence that follows from a duty', () => {
    const school1Day = (over: Record<string, any> = {}) => ({
      id: 'd1',
      date: '2026-11-25',
      schoolId: 'school-1',
      ...over,
    });

    const assignAv = async () =>
      service.assignDuty('cong-1', 'school-1', 'r1', { helperId: 'h1' }, admin);

    const withDuty = (helperId: string | null) => {
      days.find = jest.fn(async () => [school1Day()]);
      days.findOne = jest.fn(async () => school1Day());
      duties.find = jest.fn(async () => [
        {
          id: 'r1',
          dayId: 'd1',
          dutyType: DutyType.AV,
          slotIndex: 0,
          congregationId: 'cong-1',
          helperId,
        },
      ]);
      duties.findOne = jest.fn(async () => ({
        id: 'r1',
        dayId: 'd1',
        dutyType: DutyType.AV,
        slotIndex: 0,
        congregationId: 'cong-1',
        helperId: null,
      }));
      absences.find = jest.fn(async () => []);
      // assignDuty checks the helper exists before it writes.
      helpers.findOne = jest.fn(async () => ({
        id: 'h1',
        congregationId: 'cong-1',
      }));
    };

    it('records the brother as away on the evening our meeting is held', async () => {
      // The day is asked of the meeting rules, not guessed from a weekday —
      // so a circuit visit that moves the meeting moves this too.
      withDuty('h1');
      helpers.find = jest.fn(async () => [
        { id: 'h1', publisherId: 'pub-1', congregationId: 'cong-1' },
      ]);
      meetingAttendance.pendingForWeek = jest.fn(async () => [
        { date: '2026-11-25', eventType: EventType.MIDWEEK },
      ]);

      await assignAv();

      expect(absences.save).toHaveBeenCalledWith(
        expect.objectContaining({
          publisherId: 'pub-1',
          startDate: '2026-11-25',
          pioneerSchoolDutyId: 'r1',
        }),
      );
    });

    it('says nothing when that week holds no midweek meeting', async () => {
      // An assembly replaced it: there is no meeting to miss.
      withDuty('h1');
      helpers.find = jest.fn(async () => [
        { id: 'h1', publisherId: 'pub-1', congregationId: 'cong-1' },
      ]);
      meetingAttendance.pendingForWeek = jest.fn(async () => [
        { date: '2026-11-29', eventType: EventType.WEEKEND },
      ]);

      await assignAv();

      expect(absences.save).not.toHaveBeenCalled();
    });

    it('says nothing about a brother from another congregation', async () => {
      withDuty('h1');
      helpers.find = jest.fn(async () => [
        { id: 'h1', publisherId: null, congregationName: 'Зост' },
      ]);
      meetingAttendance.pendingForWeek = jest.fn(async () => [
        { date: '2026-11-25', eventType: EventType.MIDWEEK },
      ]);

      await assignAv();

      expect(absences.save).not.toHaveBeenCalled();
    });

    it('takes the absence back when the slot is cleared', async () => {
      withDuty(null);
      helpers.find = jest.fn(async () => [
        { id: 'h1', publisherId: 'pub-1', congregationId: 'cong-1' },
      ]);
      meetingAttendance.pendingForWeek = jest.fn(async () => [
        { date: '2026-11-25', eventType: EventType.MIDWEEK },
      ]);
      absences.find = jest.fn(async () => [
        {
          id: 'abs-1',
          pioneerSchoolDutyId: 'r1',
          publisherId: 'pub-1',
          startDate: '2026-11-25',
        },
      ]);

      await service.assignDuty(
        'cong-1',
        'school-1',
        'r1',
        { helperId: null },
        admin,
      );

      expect(absences.delete).toHaveBeenCalledWith('abs-1');
      expect(absences.save).not.toHaveBeenCalled();
    });

    it('catches up on assignments made before any of this existed', async () => {
      // Reading the schedule reconciles it: nothing else would ever revisit a
      // duty that was filled in earlier.
      withDuty('h1');
      helpers.find = jest.fn(async () => [
        { id: 'h1', publisherId: 'pub-1', congregationId: 'cong-1' },
      ]);
      meetingAttendance.pendingForWeek = jest.fn(async () => [
        { date: '2026-11-25', eventType: EventType.MIDWEEK },
      ]);
      duties.find = jest.fn(async () => [
        {
          id: 'r1',
          dayId: 'd1',
          dutyType: DutyType.AV,
          slotIndex: 0,
          congregationId: 'cong-1',
          helperId: 'h1',
        },
      ]);

      await service.getFull('cong-1', 'school-1', admin);

      expect(absences.save).toHaveBeenCalledWith(
        expect.objectContaining({ pioneerSchoolDutyId: 'r1' }),
      );
    });
  });

  describe('the app must not argue with itself', () => {
    it('does not call a brother away because of THIS school\u2019s own duty', async () => {
      // Serving here on our meeting evening writes an absence; reading that
      // absence back as a warning told the reader «в этот день в отъезде»
      // about the man the very same row had just put there.
      days.find = jest.fn(async () => [
        { id: 'd1', date: '2026-11-25', schoolId: 'school-1' },
      ]);
      helpers.find = jest.fn(async () => [
        { id: 'h1', firstName: 'Л', lastName: 'Б', publisherId: 'pub-1' },
      ]);
      duties.find = jest.fn(async () => [
        {
          id: 'r1',
          dayId: 'd1',
          dutyType: DutyType.AV,
          slotIndex: 0,
          helperId: 'h1',
          customLabel: null,
        },
      ]);
      absences.find = jest.fn(async () => [
        {
          id: 'abs-1',
          publisherId: 'pub-1',
          startDate: '2026-11-25',
          endDate: null,
          pioneerSchoolDutyId: 'r1',
        },
      ]);

      const full = await service.getFull('cong-1', 'school-1', admin);

      expect(full.days[0].duties[0].warnings).not.toContain('away');
    });

    it('still says it when the absence comes from ANOTHER school', async () => {
      // Booked in Soest that evening, he genuinely cannot be in Ahlen.
      days.find = jest.fn(async () => [
        { id: 'd1', date: '2026-11-25', schoolId: 'school-1' },
      ]);
      helpers.find = jest.fn(async () => [
        { id: 'h1', firstName: 'Л', lastName: 'Б', publisherId: 'pub-1' },
      ]);
      duties.find = jest.fn(async () => [
        {
          id: 'r1',
          dayId: 'd1',
          dutyType: DutyType.AV,
          slotIndex: 0,
          helperId: 'h1',
          customLabel: null,
        },
      ]);
      absences.find = jest.fn(async () => [
        {
          id: 'abs-2',
          publisherId: 'pub-1',
          startDate: '2026-11-25',
          endDate: null,
          pioneerSchoolDutyId: 'duty-of-another-school',
        },
      ]);

      const full = await service.getFull('cong-1', 'school-1', admin);

      expect(full.days[0].duties[0].warnings).toContain('away');
    });

    it('journals who was put on which role, in words', async () => {
      days.find = jest.fn(async () => [
        { id: 'd1', date: '2026-11-25', schoolId: 'school-1' },
      ]);
      days.findOne = jest.fn(async () => ({
        id: 'd1',
        date: '2026-11-25',
        schoolId: 'school-1',
      }));
      duties.findOne = jest.fn(async () => ({
        id: 'r1',
        dayId: 'd1',
        dutyType: DutyType.MICROPHONE,
        slotIndex: 1,
        congregationId: 'cong-1',
        helperId: null,
        customLabel: null,
      }));
      duties.find = jest.fn(async () => []);
      helpers.findOne = jest.fn(async () => ({
        id: 'h1',
        firstName: 'Иван',
        lastName: 'Петров',
        congregationId: 'cong-1',
      }));
      helpers.find = jest.fn(async () => []);
      absences.find = jest.fn(async () => []);

      await service.assignDuty(
        'cong-1',
        'school-1',
        'r1',
        { helperId: 'h1' },
        admin,
      );

      const call = audit.logUpdate.mock.calls[0][0];
      expect(call.fields[0]).toBe('2026-11-25 · microphone 2');
      expect(call.after['2026-11-25 · microphone 2']).toBe('Иван Петров');
    });
  });

  describe('warnings', () => {
    const withDay = () => {
      days.rows = [
        {
          id: 'd1',
          date: '2026-11-23',
          schoolId: 'school-1',
          startTime: null,
          endTime: null,
        },
      ];
      days.find = jest.fn(async () => days.rows);
    };

    it('says when a brother is away that day', async () => {
      withDay();
      helpers.rows = [
        {
          id: 'h1',
          firstName: 'Иван',
          lastName: 'Петров',
          publisherId: 'pub-1',
          congregationName: null,
        },
      ];
      helpers.find = jest.fn(async () => helpers.rows);
      duties.rows = [
        {
          id: 'r1',
          dayId: 'd1',
          dutyType: DutyType.AV,
          slotIndex: 0,
          helperId: 'h1',
          customLabel: null,
        },
      ];
      duties.find = jest.fn(async () => duties.rows);
      absences.find = jest.fn(async () => [
        {
          publisherId: 'pub-1',
          startDate: '2026-11-20',
          endDate: '2026-11-25',
        },
      ]);

      const full = await service.getFull('cong-1', 'school-1', admin);

      expect(full.days[0].duties[0].warnings).toContain('away');
    });

    it('says when the same brother holds both microphones in a day', async () => {
      // Not merely awkward — impossible, and found out in front of the class.
      withDay();
      helpers.rows = [
        {
          id: 'h1',
          firstName: 'Иван',
          lastName: 'Петров',
          publisherId: null,
          congregationName: 'Зост',
        },
      ];
      helpers.find = jest.fn(async () => helpers.rows);
      duties.rows = [
        {
          id: 'm0',
          dayId: 'd1',
          dutyType: DutyType.MICROPHONE,
          slotIndex: 0,
          helperId: 'h1',
          customLabel: null,
        },
        {
          id: 'm1',
          dayId: 'd1',
          dutyType: DutyType.MICROPHONE,
          slotIndex: 1,
          helperId: 'h1',
          customLabel: null,
        },
      ];
      duties.find = jest.fn(async () => duties.rows);

      const full = await service.getFull('cong-1', 'school-1', admin);

      expect(full.days[0].duties[0].warnings).toContain('twoMicrophones');
      expect(full.days[0].duties[1].warnings).toContain('twoMicrophones');
    });

    it('says nothing about a brother from another congregation we know nothing about', async () => {
      // He has no card here, so there is no absence and no meeting duty to
      // check — and inventing a warning from silence would be worse than none.
      withDay();
      helpers.rows = [
        {
          id: 'h1',
          firstName: 'Пётр',
          lastName: 'Сидоров',
          publisherId: null,
          congregationName: 'Зост',
        },
      ];
      helpers.find = jest.fn(async () => helpers.rows);
      duties.rows = [
        {
          id: 'r1',
          dayId: 'd1',
          dutyType: DutyType.AV,
          slotIndex: 0,
          helperId: 'h1',
          customLabel: null,
        },
      ];
      duties.find = jest.fn(async () => duties.rows);

      const full = await service.getFull('cong-1', 'school-1', admin);

      expect(full.days[0].duties[0].warnings).toEqual([]);
      expect(full.days[0].duties[0].helperCongregation).toBe('Зост');
    });
  });
});
