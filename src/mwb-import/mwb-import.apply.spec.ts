import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MwbImportService } from './mwb-import.service';
import { Assignment } from '../entities/assignment.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { ApplyParsedDto } from './dto/apply-parsed.dto';

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
});
