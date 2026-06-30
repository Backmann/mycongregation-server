import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';

const CONG = 'cong-1';

// Deterministic across any run date: 2020 is past, 2099 is future.
function meeting(partial: Partial<FieldServiceMeeting>): FieldServiceMeeting {
  return {
    weekStartDate: '2020-01-06',
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Hall',
    conductorPublisherId: null,
    topic: null,
    sourceUrl: null,
    isGeneral: false,
    ...partial,
  } as FieldServiceMeeting;
}

async function buildService(rows: FieldServiceMeeting[]) {
  const repo = { find: jest.fn().mockResolvedValue(rows) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      FieldServiceMeetingsService,
      { provide: getRepositoryToken(FieldServiceMeeting), useValue: repo },
    ],
  }).compile();
  return moduleRef.get(FieldServiceMeetingsService);
}

describe('FieldServiceMeetingsService.conductorStats', () => {
  it('counts total and tracks last (past) + next (future) per conductor', async () => {
    const service = await buildService([
      meeting({ conductorPublisherId: 'A', weekStartDate: '2020-01-06' }), // 2020-01-11
      meeting({ conductorPublisherId: 'A', weekStartDate: '2020-02-03' }), // 2020-02-08
      meeting({ conductorPublisherId: 'A', weekStartDate: '2099-03-02' }), // 2099-03-07
      meeting({ conductorPublisherId: 'B', weekStartDate: '2099-01-05' }), // 2099-01-10
      meeting({ conductorPublisherId: null }), // ignored
    ]);
    const stats = await service.conductorStats(CONG);
    const a = stats.find((s) => s.conductorPublisherId === 'A')!;
    const b = stats.find((s) => s.conductorPublisherId === 'B')!;
    expect(a).toEqual({
      conductorPublisherId: 'A',
      total: 3,
      lastDate: '2020-02-08',
      nextDate: '2099-03-07',
    });
    // B has only a future meeting → never led yet.
    expect(b).toEqual({
      conductorPublisherId: 'B',
      total: 1,
      lastDate: null,
      nextDate: '2099-01-10',
    });
    // Null-conductor meeting is excluded entirely.
    expect(stats).toHaveLength(2);
  });

  it('returns an empty list when nobody is assigned', async () => {
    const service = await buildService([
      meeting({ conductorPublisherId: null }),
    ]);
    expect(await service.conductorStats(CONG)).toEqual([]);
  });
});

describe('FieldServiceMeetingsService.topicHistory', () => {
  it('dedupes topics case-insensitively and keeps the latest date', async () => {
    const service = await buildService([
      meeting({ topic: 'Дом', weekStartDate: '2020-01-06' }), // 2020-01-11
      meeting({ topic: '  дом ', weekStartDate: '2020-02-03' }), // 2020-02-08, same topic
      meeting({ topic: 'Улица', weekStartDate: '2020-01-06' }), // 2020-01-11
      meeting({ topic: '   ', weekStartDate: '2020-01-06' }), // blank → ignored
      meeting({ topic: null }), // ignored
    ]);
    const hist = await service.topicHistory(CONG);
    expect(hist).toHaveLength(2);
    const dom = hist.find((h) => h.topic.toLowerCase() === 'дом')!;
    expect(dom.lastDate).toBe('2020-02-08');
    const street = hist.find((h) => h.topic === 'Улица')!;
    expect(street.lastDate).toBe('2020-01-11');
  });
});
