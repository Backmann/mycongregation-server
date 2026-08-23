import { PublicTalksService } from './public-talks.service';
import { PublicTalk } from '../entities/public-talk.entity';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * Retiring a list of talks, as the instruction asks for it.
 *
 * Two things the coordinator cannot see for himself: the titles behind thirty
 * bare numbers, and which of those talks are already promised to a speaker
 * after the date. The second is a telephone call, not a database row — so the
 * app shows the call that has to be made and leaves the making of it to him.
 */
describe('PublicTalksService.previewRetirement', () => {
  const build = (
    talks: Array<{
      id: string;
      number: number;
      title: string;
      isActive?: boolean;
    }>,
    assignments: Array<{
      publicTalkId: string;
      weekStartDate: string;
      speakerName?: string;
      speakerCongregation?: string;
    }> = [],
    exchange: Array<{
      publicTalkId: string;
      date: string;
      direction: string;
      speakerName?: string;
      speakerCongregation?: string;
    }> = [],
    settings: Array<{ effectiveFrom: string; weekendDow: number }> = [
      { effectiveFrom: '2000-01-01', weekendDow: 7 },
    ],
  ) => {
    const store = new Map(
      talks.map((t) => [
        t.number,
        { isActive: true, retiredFrom: null, ...t } as PublicTalk,
      ]),
    );
    const repo = {
      find: jest.fn(async () => [...store.values()]),
      save: jest.fn(async (t: PublicTalk) => {
        store.set(t.number, t);
        return t;
      }),
    };
    const assignmentsRepo = { find: jest.fn(async () => assignments) };
    const service = new PublicTalksService(
      repo as unknown as Repository<PublicTalk>,
      assignmentsRepo as never,
      { find: jest.fn(async () => exchange) } as never,
      { find: jest.fn(async () => settings) } as never,
      {
        logEvent: jest.fn(),
        findForEntity: jest.fn(),
      } as unknown as AuditLogService,
    );
    return { service, store };
  };

  it('puts a title beside every number', async () => {
    const { service } = build([
      { id: 't84', number: 84, title: 'Служим там, где нужна помощь' },
    ]);

    const out = await service.previewRetirement('c1', [84], '2026-09-01');

    expect(out.talks[0]).toMatchObject({
      number: 84,
      title: 'Служим там, где нужна помощь',
    });
  });

  it('names the weeks where a retired talk is still promised', async () => {
    // The whole point: a speaker invited in July for the 13th of September.
    const { service } = build(
      [{ id: 't92', number: 92, title: 'Речь' }],
      [
        {
          publicTalkId: 't92',
          weekStartDate: '2026-09-07',
          speakerName: 'Иванов',
          speakerCongregation: 'Хамм',
        },
      ],
    );

    const out = await service.previewRetirement('c1', [92], '2026-09-01');

    expect(out.talks[0].scheduled).toEqual([
      {
        publicTalkId: 't92',
        weekStartDate: '2026-09-07',
        // The Sunday, not the Monday the week is filed under: «26 октября»
        // for a talk given on the 1st of November is a date the coordinator
        // cannot match against anything he knows.
        meetingDate: '2026-09-13',
        speakerName: 'Иванов',
        speakerCongregation: 'Хамм',
        source: 'programme',
      },
    ]);
  });

  it('uses the weekend day the congregation actually meets on', async () => {
    // A congregation meeting on Saturday gets Saturday — read from the
    // settings version in force for that week, not from a default.
    const { service } = build(
      [{ id: 't92', number: 92, title: 'Речь' }],
      [{ publicTalkId: 't92', weekStartDate: '2026-09-07' }],
      [],
      [{ effectiveFrom: '2000-01-01', weekendDow: 6 }],
    );

    const out = await service.previewRetirement('c1', [92], '2026-09-01');

    expect(out.talks[0].scheduled[0].meetingDate).toBe('2026-09-12');
  });

  it('follows a congregation that MOVED its weekend meeting', async () => {
    // Two versions: Sunday until October, Saturday after. The week must be
    // judged by the one in force for it.
    const { service } = build(
      [{ id: 't92', number: 92, title: 'Речь' }],
      [{ publicTalkId: 't92', weekStartDate: '2026-10-26' }],
      [],
      [
        { effectiveFrom: '2000-01-01', weekendDow: 7 },
        { effectiveFrom: '2026-10-01', weekendDow: 6 },
      ],
    );

    const out = await service.previewRetirement('c1', [92], '2026-09-01');

    expect(out.talks[0].scheduled[0].meetingDate).toBe('2026-10-31');
  });

  it('finds a talk one of OUR brothers is taking to another congregation', async () => {
    // The one that was missed entirely: he would have travelled and given a
    // talk that is no longer used, and nothing would have said a word.
    const { service } = build(
      [{ id: 't92', number: 92, title: 'Речь' }],
      [],
      [
        {
          publicTalkId: 't92',
          date: '2026-09-20',
          direction: 'outgoing',
          speakerName: null as unknown as string,
        },
      ],
    );

    const out = await service.previewRetirement('c1', [92], '2026-09-01');

    expect(out.talks[0].scheduled[0]).toMatchObject({
      meetingDate: '2026-09-20',
      source: 'outgoing',
    });
  });

  it('finds a visiting speaker bringing one to us', async () => {
    const { service } = build(
      [{ id: 't92', number: 92, title: 'Речь' }],
      [],
      [
        {
          publicTalkId: 't92',
          date: '2026-09-20',
          direction: 'incoming',
          speakerName: 'Петров',
          speakerCongregation: 'Дортмунд',
        },
      ],
    );

    const out = await service.previewRetirement('c1', [92], '2026-09-01');

    expect(out.talks[0].scheduled[0]).toMatchObject({
      source: 'incoming',
      speakerName: 'Петров',
    });
  });

  it('puts everything in date order, wherever it came from', async () => {
    const { service } = build(
      [{ id: 't92', number: 92, title: 'Речь' }],
      [{ publicTalkId: 't92', weekStartDate: '2026-10-26' }],
      [{ publicTalkId: 't92', date: '2026-09-20', direction: 'outgoing' }],
    );

    const out = await service.previewRetirement('c1', [92], '2026-09-01');

    expect(out.talks[0].scheduled.map((u) => u.meetingDate)).toEqual([
      '2026-09-20',
      '2026-11-01',
    ]);
  });

  it('asks only for weeks from the date onwards', async () => {
    // A talk given in August is not a problem; only what is still ahead of the
    // date it stops being used.
    const { service } = build([{ id: 't92', number: 92, title: 'Речь' }]);

    await service.previewRetirement('c1', [92], '2026-09-01');

    const call = (
      service as unknown as { assignmentsRepo: { find: jest.Mock } }
    ).assignmentsRepo.find.mock.calls[0][0] as {
      where: { weekStartDate: { value: string; type: string } };
    };
    // MoreThanOrEqual is an object, not a string — assert what it carries.
    expect(call.where.weekStartDate.value).toBe('2026-09-01');
    expect(call.where.weekStartDate.type).toBe('moreThanOrEqual');
  });

  it('names a number the catalogue has never heard of', async () => {
    // A typo in a pasted list, or a catalogue that was never imported. Either
    // way it must not pass in silence.
    const { service } = build([{ id: 't84', number: 84, title: 'Речь' }]);

    const out = await service.previewRetirement('c1', [84, 999], '2026-09-01');

    expect(out.unknownNumbers).toEqual([999]);
  });

  it('marks one that was already retired', async () => {
    const { service } = build([
      { id: 't84', number: 84, title: 'Речь', isActive: false },
    ]);

    const out = await service.previewRetirement('c1', [84], '2026-09-01');

    expect(out.talks[0].alreadyRetired).toBe(true);
  });

  it('changes nothing at all — it is a question, not an act', async () => {
    const { service, store } = build([
      { id: 't84', number: 84, title: 'Речь' },
    ]);

    await service.previewRetirement('c1', [84], '2026-09-01');

    expect(store.get(84)?.isActive).toBe(true);
  });
});

describe('PublicTalksService.retireMissing — the date', () => {
  const build = () => {
    const store = new Map<number, PublicTalk>([
      [84, { number: 84, isActive: true, retiredFrom: null } as PublicTalk],
    ]);
    const repo = {
      find: jest.fn(async () => [...store.values()]),
      save: jest.fn(async (t: PublicTalk) => {
        store.set(t.number, t);
        return t;
      }),
    };
    const service = new PublicTalksService(
      repo as unknown as Repository<PublicTalk>,
      { find: jest.fn() } as never,
      { find: jest.fn(async () => []) } as never,
      { find: jest.fn(async () => []) } as never,
      {
        logEvent: jest.fn(),
        findForEntity: jest.fn(),
      } as unknown as AuditLogService,
    );
    return { service, store };
  };

  it('records the date the talk stops being given', async () => {
    const { service, store } = build();

    await service.retireMissing('c1', [84], 'u1', '2026-09-01');

    expect(store.get(84)?.retiredFrom).toBe('2026-09-01');
    expect(store.get(84)?.isActive).toBe(false);
  });

  it('accepts a retirement with no date, as retiring by hand always was', async () => {
    const { service, store } = build();

    await service.retireMissing('c1', [84], 'u1');

    expect(store.get(84)?.retiredFrom).toBeNull();
    expect(store.get(84)?.isActive).toBe(false);
  });
});
