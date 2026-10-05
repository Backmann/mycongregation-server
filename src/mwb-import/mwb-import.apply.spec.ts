import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MwbImportService } from './mwb-import.service';
import { CoVisitTemplateService } from '../special-events/co-visit-template.service';
import { Assignment } from '../entities/assignment.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { ApplyParsedDto } from './dto/apply-parsed.dto';
import { MeetingAttendanceService } from '../meeting-attendance/meeting-attendance.service';
import { HeldByVisit, nothingHeld } from '../special-events/co-visit-held';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';

// The import now reaches the talk journal, and the journal reaches the push
// service, whose SDK is an ES module jest cannot load. Nothing here sends.
jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/** The journal behind the weekend; the cases look at what it was asked. */
const journal = {
  fillEmptySlot: jest.fn(async () => undefined),
  syncProgramToJournal: jest.fn(async () => undefined),
};

/** What a circuit visit holds in the week; nothing, unless a case says so. */
let heldNow: HeldByVisit = nothingHeld();
const held = () => heldNow;

describe('MwbImportService.applyParsed (client-parsed workbook)', () => {
  let service: MwbImportService;
  let repo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    heldNow = nothingHeld();
    journal.fillEmptySlot.mockClear();
    journal.syncProgramToJournal.mockClear();
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
          useValue: {
            applyForWeek: jest.fn(async () => undefined),
            heldForWeek: jest.fn(async () => held()),
          },
        },
        { provide: TalkExchangeService, useValue: journal },
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
      meetings: { date: string; eventType: string }[],
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
            useValue: {
              applyForWeek: jest.fn(async () => undefined),
              heldForWeek: jest.fn(async () => held()),
            },
          },
          { provide: TalkExchangeService, useValue: journal },
          {
            provide: MeetingAttendanceService,
            useValue: { pendingForWeek: jest.fn(async () => meetings) },
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

  describe('a week a circuit visit has rewritten', () => {
    /**
     * 5 October: the January 2027 workbook loaded a second time into the week
     * of a visit. The visit's closing-song row has the key of the workbook's
     * middle song and nobody assigned, so the import took it for an empty
     * template and wrote «Песня 64» over it; the closing prayer got back the
     * song the visit had taken off it. Reproduced on the stand row for row.
     */
    function visitWeekDto(): ApplyParsedDto {
      return {
        epubFile: 'mwb_U_202701.epub',
        year: 2027,
        weeks: [
          {
            weekStartDate: '2027-02-22',
            weekEndDate: '2027-02-28',
            biblePassage: '',
            parts: [
              {
                partKey: 'mid_song',
                partOrder: 9,
                partTitle: 'Песня 64',
                partDurationMin: null,
              },
              {
                partKey: 'midweek_closing_prayer',
                partOrder: 15,
                partTitle: 'Заключительные слова | Песня 35 и молитва',
                partDurationMin: 3,
              },
            ],
          },
        ],
      };
    }
    const row = (over: Partial<Assignment>): Assignment =>
      ({
        congregationId: 'cong-1',
        weekStartDate: '2027-02-22',
        eventType: EventType.MIDWEEK,
        publisherId: null,
        assistantPublisherId: null,
        partDurationMin: null,
        status: AssignmentStatus.DRAFT,
        ...over,
      }) as Assignment;

    /** The week as the visit left it: its own song row, the prayer bare. */
    function asTheVisitLeftIt() {
      heldNow = {
        added: new Set(['song-of-visit']),
        fields: new Map([['prayer', new Set(['partTitle'] as const)]]),
        hidden: new Set(),
      };
      return [
        row({
          id: 'song-mid',
          partKey: 'mid_song',
          partOrder: 9,
          partTitle: 'Песня 64',
        }),
        row({
          id: 'song-of-visit',
          partKey: 'mid_song',
          partOrder: 14,
          partTitle: null,
        }),
        row({
          id: 'prayer',
          partKey: 'midweek_closing_prayer',
          partOrder: 15,
          partTitle: null,
          partDurationMin: 3,
        }),
      ];
    }

    it("leaves the overseer's song row alone", async () => {
      const rows = asTheVisitLeftIt();
      repo.find.mockResolvedValue(rows);
      await service.applyParsed('cong-1', visitWeekDto());
      const song = rows.find((r) => r.id === 'song-of-visit');
      expect(song?.partTitle).toBeNull();
      expect(song?.partOrder).toBe(14);
    });

    it('does not give the closing prayer its song back', async () => {
      const rows = asTheVisitLeftIt();
      repo.find.mockResolvedValue(rows);
      await service.applyParsed('cong-1', visitWeekDto());
      expect(rows.find((r) => r.id === 'prayer')?.partTitle).toBeNull();
    });

    it('keeps a song the overseer has already been given', async () => {
      const rows = asTheVisitLeftIt();
      rows[1].partTitle = 'Песня 151';
      repo.find.mockResolvedValue(rows);
      await service.applyParsed('cong-1', visitWeekDto());
      const song = rows.find((r) => r.id === 'song-of-visit');
      expect(song?.partTitle).toBe('Песня 151');
      expect(song?.partOrder).toBe(14);
    });

    it('creates no second song and still refreshes the workbook one', async () => {
      const rows = asTheVisitLeftIt();
      rows[0].partTitle = 'Песня 1';
      repo.find.mockResolvedValue(rows);
      const result = await service.applyParsed('cong-1', visitWeekDto());
      expect(result.partsCreated).toBe(0);
      expect(rows[0].partTitle).toBe('Песня 64');
    });

    it('puts right a week an earlier import spoiled', async () => {
      const rows = asTheVisitLeftIt();
      // What the second import of 5 October left behind.
      rows[1].partTitle = 'Песня 64';
      rows[1].partOrder = 9;
      rows[2].partTitle = 'Заключительные слова | Песня 35 и молитва';
      repo.find.mockResolvedValue(rows);
      await service.applyParsed('cong-1', visitWeekDto());
      expect(rows[1].partTitle).toBeNull();
      expect(rows[1].partOrder).toBe(14);
      expect(rows[2].partTitle).toBeNull();
      // The workbook's own song stays where the workbook puts it.
      expect(rows[0].partTitle).toBe('Песня 64');
      expect(rows[0].partOrder).toBe(9);
    });

    /**
     * The study the visit hid is still the week's row. The workbook's study
     * used to be created beside it and folded away straight after — «+2
     * создано» on the screen, in a week where nothing new could be seen.
     */
    describe('the study the visit hid', () => {
      const studyDto = (): ApplyParsedDto => {
        const dto = visitWeekDto();
        dto.weeks[0].parts = [
          {
            partKey: 'cbs_conductor',
            partOrder: 13,
            partTitle: 'Изучение Библии в собрании: гл. 27',
            partDurationMin: 30,
          },
        ];
        return dto;
      };
      const hiddenStudy = (over: Partial<Assignment> = {}) =>
        row({
          id: 'study',
          partKey: 'cbs_conductor',
          partOrder: 13,
          partTitle: 'Изучение Библии в собрании: гл. 26',
          partDurationMin: 30,
          deletedAt: new Date('2026-10-05T10:00:00Z'),
          ...over,
        });
      const arrange = (study: Assignment) => {
        heldNow = { ...nothingHeld(), hidden: new Set(['study']) };
        repo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([study]);
      };

      it('takes the new title and no second study is created', async () => {
        const study = hiddenStudy();
        arrange(study);
        const result = await service.applyParsed('cong-1', studyDto());
        expect(result.partsCreated).toBe(0);
        expect(result.partsUpdated).toBe(1);
        expect(repo.create).not.toHaveBeenCalled();
        expect(study.partTitle).toBe('Изучение Библии в собрании: гл. 27');
        // Still hidden: the visit stands.
        expect(study.deletedAt).toBeInstanceOf(Date);
      });

      it('is left as it is when a brother was already assigned to it', async () => {
        const study = hiddenStudy({ publisherId: 'p-1' });
        arrange(study);
        const result = await service.applyParsed('cong-1', studyDto());
        expect(result.partsCreated).toBe(0);
        expect(result.partsSkipped).toBe(1);
        expect(study.partTitle).toBe('Изучение Библии в собрании: гл. 26');
      });

      it('of another week or another meeting is not this one', async () => {
        const study = hiddenStudy({ weekStartDate: '2027-03-01' });
        arrange(study);
        const result = await service.applyParsed('cong-1', studyDto());
        expect(result.partsCreated).toBe(1);
      });
    });

    it('is an ordinary import where no visit holds anything', async () => {
      const rows = asTheVisitLeftIt();
      heldNow = nothingHeld();
      rows.splice(1, 1);
      repo.find.mockResolvedValue(rows);
      await service.applyParsed('cong-1', visitWeekDto());
      expect(rows.find((r) => r.id === 'prayer')?.partTitle).toBe(
        'Заключительные слова | Песня 35 и молитва',
      );
    });
  });

  describe('the Watchtower comes in this way too', () => {
    /**
     * Since 12 June the app parses both publications itself and sends them
     * here. On 27 September two corrections for the weekend were written into
     * WtImportService — which nothing called any more — so they never ran:
     * loading the Watchtower again wiped the theme of a week whose speaker
     * came from elsewhere, and a talk arranged in the journal before the week
     * existed did not reach the new slot. Both reproduced on the stand on
     * 5 October, with the real November 2026 issue.
     */
    function weekendDto(): ApplyParsedDto {
      return {
        epubFile: 'w_U_202611.epub',
        year: 2027,
        weeks: [
          {
            weekStartDate: '2027-01-11',
            weekEndDate: '2027-01-17',
            biblePassage: '',
            parts: [
              {
                partKey: 'public_talk_speaker',
                partOrder: 4,
                partTitle: null,
                partDurationMin: 30,
              },
              {
                partKey: 'watchtower_conductor',
                partOrder: 6,
                partTitle: 'Статья для изучения',
                partDurationMin: 60,
              },
            ],
          },
        ],
      };
    }
    const talk = (over: Partial<Assignment>): Assignment =>
      ({
        id: 'talk',
        congregationId: 'cong-1',
        weekStartDate: '2027-01-11',
        eventType: EventType.WEEKEND,
        partKey: 'public_talk_speaker',
        partOrder: 4,
        partTitle: '№12. Тема речи',
        partDurationMin: 30,
        publisherId: null,
        assistantPublisherId: null,
        status: AssignmentStatus.DRAFT,
        ...over,
      }) as Assignment;

    it.each([
      ['a speaker named by hand', { speakerName: 'Иван Тестов' }],
      ['a visiting speaker from the directory', { visitingSpeakerId: 'vs-1' }],
      ['a talk from the catalogue', { publicTalkId: 'pt-1' }],
      ['a special talk', { specialTalk: true }],
    ])('keeps the theme of a public talk filled by %s', async (_, filled) => {
      const row = talk(filled);
      repo.find.mockResolvedValue([row]);
      const result = await service.applyParsed('cong-1', weekendDto());
      expect(row.partTitle).toBe('№12. Тема речи');
      expect(result.partsSkipped).toBe(1);
    });

    it('still refreshes a public talk nobody is on', async () => {
      const row = talk({ partTitle: 'старое' });
      repo.find.mockResolvedValue([row]);
      await service.applyParsed('cong-1', weekendDto());
      expect(row.partTitle).toBeNull();
    });

    it('offers the new week to the journal', async () => {
      await service.applyParsed('cong-1', weekendDto());
      expect(journal.fillEmptySlot).toHaveBeenCalledWith(
        'cong-1',
        '2027-01-11',
      );
    });

    it('does not have the journal mirror the week — see the service for why', async () => {
      await service.applyParsed('cong-1', weekendDto());
      expect(journal.syncProgramToJournal).not.toHaveBeenCalled();
    });

    it('leaves the journal out of a midweek programme', async () => {
      await service.applyParsed('cong-1', weekDto());
      expect(journal.fillEmptySlot).not.toHaveBeenCalled();
      expect(journal.syncProgramToJournal).not.toHaveBeenCalled();
    });
  });
});
