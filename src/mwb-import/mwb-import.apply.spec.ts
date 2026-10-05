import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MwbImportService } from './mwb-import.service';
import { CoVisitTemplateService } from '../special-events/co-visit-template.service';
import { Assignment } from '../entities/assignment.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { ApplyParsedDto } from './dto/apply-parsed.dto';
import { MeetingAttendanceService } from '../meeting-attendance/meeting-attendance.service';

describe('MwbImportService.applyParsed (client-parsed workbook)', () => {
  let service: MwbImportService;
  let repo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MwbImportService,
        { provide: getRepositoryToken(Assignment), useValue: repo },
        {
          // Offers the circuit-visit template to the week; nothing to offer here.
          provide: CoVisitTemplateService,
          useValue: { applyForWeek: jest.fn(async () => undefined) },
        },
        {
          // The import now asks which meetings the week actually holds — a
          // Memorial or a convention takes one away and its parts must not be
          // created. These cases are about ordinary weeks, so both meetings
          // are held.
          provide: MeetingAttendanceService,
          useValue: {
            pendingForWeek: jest.fn(async () => [
              { date: '2026-01-01', eventType: 'midweek' },
              { date: '2026-01-04', eventType: 'weekend' },
            ]),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(MwbImportService);
  });

  function weekDto(): ApplyParsedDto {
    return {
      epubFile: 'mwb_U_202605.epub',
      year: 2026,
      weeks: [
        {
          weekStartDate: '2026-05-04',
          weekEndDate: '2026-05-10',
          biblePassage: 'ИСАЙЯ 58, 59',
          parts: [
            {
              partKey: 'midweek_chairman',
              partOrder: 1,
              partTitle: null,
              partDurationMin: null,
            },
            {
              partKey: 'bible_reading',
              partOrder: 5,
              partTitle: 'Чтение Библии: Иса 58:1—14',
              partDurationMin: 4,
            },
            {
              partKey: 'cbs_conductor',
              partOrder: 13,
              partTitle: 'Изучение Библии в собрании',
              partDurationMin: 30,
            },
          ],
        },
      ],
    };
  }

  it('creates draft midweek assignments and counts them', async () => {
    const result = await service.applyParsed('cong-1', weekDto());

    expect(result.weeksImported).toBe(1);
    expect(result.partsCreated).toBe(3);
    expect(result.partsUpdated).toBe(0);
    expect(result.partsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    expect(repo.save).toHaveBeenCalledTimes(3);
    const saved = repo.save.mock.calls.map((c) => c[0]);
    for (const a of saved) {
      expect(a.congregationId).toBe('cong-1');
      expect(a.weekStartDate).toBe('2026-05-04');
      expect(a.eventType).toBe(EventType.MIDWEEK);
      expect(a.status).toBe(AssignmentStatus.DRAFT);
    }
  });

  it('stores client titles verbatim (no re-extraction mangling)', async () => {
    await service.applyParsed('cong-1', weekDto());

    const reading = repo.save.mock.calls
      .map((c) => c[0])
      .find((a) => a.partKey === 'bible_reading');
    expect(reading.partTitle).toBe('Чтение Библии: Иса 58:1—14');
    expect(reading.partDurationMin).toBe(4);

    const chairman = repo.save.mock.calls
      .map((c) => c[0])
      .find((a) => a.partKey === 'midweek_chairman');
    expect(chairman.partTitle).toBeNull();
  });

  it('skips parts with partKey "unknown" and counts them as unclassified', async () => {
    const dto = weekDto();
    dto.weeks[0].parts.push({
      partKey: 'unknown',
      partOrder: 0,
      partTitle: 'Что-то нераспознанное',
      partDurationMin: null,
    });

    const result = await service.applyParsed('cong-1', dto);

    expect(result.partsCreated).toBe(3);
    expect(result.unclassifiedParts).toBe(1);
    expect(repo.save).toHaveBeenCalledTimes(3);
  });

  it('updates an empty template in place and skips a filled assignment', async () => {
    const emptyTemplate = {
      id: 'a-1',
      partKey: 'bible_reading',
      publisherId: null,
      assistantPublisherId: null,
      partTitle: null,
      partOrder: 5,
      partDurationMin: null,
    };
    const filled = {
      id: 'a-2',
      partKey: 'cbs_conductor',
      publisherId: 'pub-9',
      assistantPublisherId: null,
      partTitle: 'Старый заголовок',
      partOrder: 13,
      partDurationMin: 30,
    };
    repo.find.mockResolvedValue([emptyTemplate, filled]);

    const result = await service.applyParsed('cong-1', weekDto());

    // chairman created, bible_reading updated in place, cbs skipped
    expect(result.partsCreated).toBe(1);
    expect(result.partsUpdated).toBe(1);
    expect(result.partsSkipped).toBe(1);

    const savedReading = repo.save.mock.calls
      .map((c) => c[0])
      .find((a) => a.partKey === 'bible_reading');
    expect(savedReading.id).toBe('a-1');
    expect(savedReading.partTitle).toBe('Чтение Библии: Иса 58:1—14');

    const savedCbs = repo.save.mock.calls
      .map((c) => c[0])
      .find((a) => a.partKey === 'cbs_conductor');
    expect(savedCbs).toBeUndefined();
  });

  describe('MwbImportService.applyParsed — a meeting the week does not hold', () => {
    /**
     * The Memorial takes a meeting away, and so does a convention or an event
     * flagged «в этот день обычной встречи нет». The workbook was applied week
     * by week regardless, so parts could be created for an evening nobody meets
     * on — and they would sit hidden behind the Memorial block, waiting to
     * confuse whoever found them.
     *
     * Two doors to this were already shut: duties refuse to be generated for a
     * displaced meeting, attendance does not ask about one. This was the third.
     * Nothing had gone wrong yet only because the workbook happens not to print
     * a midweek programme for that week — the publication's habit, not a rule of
     * ours to lean on.
     */
    async function run(
      held: { date: string; eventType: string }[],
      dto: ApplyParsedDto = weekDto(),
    ) {
      const saved: unknown[] = [];
      const repo = {
        find: jest.fn(async () => []),
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => {
          saved.push(x);
          return x;
        }),
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          MwbImportService,
          { provide: getRepositoryToken(Assignment), useValue: repo },
          {
            // Offers the circuit-visit template to the week; nothing to offer here.
            provide: CoVisitTemplateService,
            useValue: { applyForWeek: jest.fn(async () => undefined) },
          },
          {
            provide: MeetingAttendanceService,
            useValue: { pendingForWeek: jest.fn(async () => held) },
          },
        ],
      }).compile();
      const svc = moduleRef.get(MwbImportService);
      const out = await svc.applyParsed('cong-1', dto);
      return { out, saved };
    }

    it('creates nothing when the midweek meeting is not held that week', async () => {
      const { out, saved } = await run([
        { date: '2026-05-10', eventType: 'weekend' },
      ]);
      expect(saved).toHaveLength(0);
      expect(out.partsCreated).toBe(0);
    });

    it('says so out loud — a silent skip is how the new-year week vanished', async () => {
      const { out } = await run([{ date: '2026-05-10', eventType: 'weekend' }]);
      expect(out.warnings.join(' ')).toContain('2026-05-04');
      expect(out.warnings.join(' ')).toContain('midweek');
    });

    /**
     * 5 October, on the live screen: «Пропущено: 0» straight above a sentence
     * saying thirteen parts were not imported — and the sentence in English,
     * in a Russian congregation. The count reached the week and never the
     * total; the sentence could only be printed as it came.
     */
    it('counts the parts it left out in the total, not only in the week', async () => {
      const { out } = await run([{ date: '2026-05-10', eventType: 'weekend' }]);
      expect(out.weeks[0].skipped).toBe(3);
      expect(out.partsSkipped).toBe(3);
    });

    it('does not call a week it left alone imported', async () => {
      const { out } = await run([{ date: '2026-05-10', eventType: 'weekend' }]);
      expect(out.weeksImported).toBe(0);
      // Still listed, and marked — the screen has to be able to show it.
      expect(out.weeks).toHaveLength(1);
      expect(out.weeks[0].notHeld).toBe(true);
    });

    it('says it as data the screen can put into its own language', async () => {
      const { out } = await run([{ date: '2026-05-10', eventType: 'weekend' }]);
      expect(out.notices).toEqual([
        {
          code: 'meeting_not_held',
          weekStartDate: '2026-05-04',
          meeting: 'midweek',
          parts: 3,
        },
      ]);
    });

    it('names the weekend meeting when it is the Watchtower that has no evening', async () => {
      const dto: ApplyParsedDto = {
        epubFile: 'w_U_202603.epub',
        year: 2026,
        weeks: [
          {
            weekStartDate: '2026-05-04',
            weekEndDate: '2026-05-10',
            biblePassage: '',
            parts: [
              {
                partKey: 'watchtower_conductor',
                partOrder: 3,
                partTitle: 'Изучение «Сторожевой башни»',
                partDurationMin: 60,
              },
            ],
          },
        ],
      };
      const { out, saved } = await run(
        [{ date: '2026-05-07', eventType: 'midweek' }],
        dto,
      );
      expect(saved).toHaveLength(0);
      expect(out.partsSkipped).toBe(1);
      expect(out.notices).toEqual([
        {
          code: 'meeting_not_held',
          weekStartDate: '2026-05-04',
          meeting: 'weekend',
          parts: 1,
        },
      ]);
    });

    it('keeps the old sentence for an app that has not updated', async () => {
      const { out } = await run([{ date: '2026-05-10', eventType: 'weekend' }]);
      expect(out.warnings).toHaveLength(1);
    });

    it('has nothing to say about an ordinary week', async () => {
      const { out } = await run([
        { date: '2026-05-07', eventType: 'midweek' },
        { date: '2026-05-10', eventType: 'weekend' },
      ]);
      expect(out.notices).toEqual([]);
      expect(out.weeksImported).toBe(1);
      expect(out.partsSkipped).toBe(0);
      expect(out.weeks[0].notHeld).toBeUndefined();
    });

    it('imports as before on an ordinary week', async () => {
      const { out, saved } = await run([
        { date: '2026-05-07', eventType: 'midweek' },
        { date: '2026-05-10', eventType: 'weekend' },
      ]);
      expect(saved.length).toBeGreaterThan(0);
      expect(out.partsCreated).toBeGreaterThan(0);
    });
  });
});
