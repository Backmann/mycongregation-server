// The notifications chain reaches the push SDK, which ships as ESM only.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { TalkExchangeService } from './talk-exchange.service';

/**
 * The journal rebuilt from the programme — and what must never be thrown away.
 *
 * The two-way sync began on 23 June 2026. Weekend speakers entered before that
 * day produced no journal entry: nothing was deleted, the mirror simply did not
 * exist yet. From the coordinator's chair that reads as data lost, and it is
 * worse than lost — the programme says a brother came and the journal says
 * nobody did.
 */
describe('TalkExchangeService.rebuildFromProgramme', () => {
  /**
   * `states` — как выглядят записи ДО и ПОСЛЕ прохода. Раньше подделка
   * отдавала два числа, потому что и служба считала числа; теперь она смотрит
   * на сами записи, и подделка обязана показывать то же самое.
   */
  const admin = {
    id: 'u-admin',
    email: null,
    role: 'admin',
    congregationId: 'c1',
    uiLanguage: 'ru',
  } as never;
  type Row = { id: string; visitingSpeakerId?: string | null };
  const build = (
    weeks: string[],
    states: [Row[], Row[]] = [[], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]],
  ) => {
    const synced: string[] = [];
    const snapshots = [...states];
    const service = Object.create(
      TalkExchangeService.prototype,
    ) as TalkExchangeService;
    Object.assign(service, {
      assignmentRepo: {
        find: jest.fn(async () => weeks.map((w) => ({ weekStartDate: w }))),
      },
      repo: { find: jest.fn(async () => snapshots.shift() ?? []) },
      syncProgramToJournal: jest.fn(async (_t: string, w: string) => {
        synced.push(w);
      }),
    });
    return { service, synced };
  };

  it('walks each week of the programme once', async () => {
    // The same week appears for several parts; syncing it twice would be
    // harmless but slow, and «weeks: 12» must mean twelve weeks.
    const { service, synced } = build([
      '2026-03-02',
      '2026-03-02',
      '2026-03-09',
    ]);

    const out = await service.rebuildFromProgramme('c1', '2026-03-01', admin);

    expect(synced).toEqual(['2026-03-02', '2026-03-09']);
    expect(out.weeks).toBe(2);
  });

  it('reports how many entries the journal gained', async () => {
    const { service } = build(
      ['2026-03-02'],
      [[], [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]],
    );

    await expect(
      service.rebuildFromProgramme('c1', '2026-03-01', admin),
    ).resolves.toMatchObject({ created: 5 });
  });

  it('reports nothing gained when the journal already agreed', async () => {
    // Idempotent by construction: it calls the same one-week sync used
    // everywhere else, so a week that already agrees is left alone.
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const { service } = build(['2026-03-02'], [rows, rows]);

    await expect(
      service.rebuildFromProgramme('c1', '2026-03-01', admin),
    ).resolves.toMatchObject({ created: 0, linked: 0 });
  });

  it('counts visits that gained an owner, not only rows that appeared', async () => {
    /**
     * Что случилось на настоящих данных в первый же прогон: записей не
     * прибавилось ни одной, а четыре визита впервые обрели хозяина. Прежняя
     * мерка — разница количеств — сказала «добавлено 0» и подписала это
     * словами «значит журнал и программа уже совпадают». Это была неправда, и
     * узнать её человеку было неоткуда.
     */
    const { service } = build(
      ['2026-03-02'],
      [
        [{ id: 'a', visitingSpeakerId: null }, { id: 'b' }],
        [
          { id: 'a', visitingSpeakerId: 'sp-1' },
          { id: 'b', visitingSpeakerId: 'sp-2' },
        ],
      ],
    );

    await expect(
      service.rebuildFromProgramme('c1', '2026-03-01', admin),
    ).resolves.toMatchObject({ created: 0, linked: 2 });
  });

  it('does not count a brand-new linked entry twice', async () => {
    // Появившаяся запись со связью — одно событие, и называется оно
    // «добавлено».
    const { service } = build(
      ['2026-03-02'],
      [[], [{ id: 'a', visitingSpeakerId: 'sp-1' }]],
    );

    await expect(
      service.rebuildFromProgramme('c1', '2026-03-01', admin),
    ).resolves.toMatchObject({ created: 1, linked: 0 });
  });

  it('asks only for weeks from the given date onwards', async () => {
    const { service } = build([]);

    await service.rebuildFromProgramme('c1', '2026-03-01', admin);

    const where = (
      service as unknown as { assignmentRepo: { find: jest.Mock } }
    ).assignmentRepo.find.mock.calls[0][0].where as {
      weekStartDate: { value: string };
    };
    expect(where.weekStartDate.value).toBe('2026-03-01');
  });

  /**
   * It writes the journal, and it was the one way to write it that asked
   * nobody who was asking: any signed-in member could run it (6 October).
   */
  describe('who may run it', () => {
    const member = (role: string) =>
      ({
        id: 'u1',
        email: null,
        role,
        congregationId: 'c1',
        uiLanguage: 'ru',
      }) as never;
    const withHolders = (held: number) => {
      const { service, synced } = build(['2026-03-02']);
      Object.assign(service, {
        responsibilitiesRepo: { count: jest.fn(async () => held) },
      });
      return { service, synced };
    };

    it.each(['publisher', 'ministerial_servant', 'elder'])(
      'refuses a %s who does not keep the journal, and touches nothing',
      async (role) => {
        const { service, synced } = withHolders(0);
        await expect(
          service.rebuildFromProgramme('c1', '2026-03-01', member(role)),
        ).rejects.toThrow('public talk coordinator');
        expect(synced).toEqual([]);
      },
    );

    it('lets the public talk coordinator run it', async () => {
      const { service, synced } = withHolders(1);
      await service.rebuildFromProgramme('c1', '2026-03-01', member('elder'));
      expect(synced).toEqual(['2026-03-02']);
    });

    it('lets an administrator run it', async () => {
      const { service, synced } = withHolders(0);
      await service.rebuildFromProgramme('c1', '2026-03-01', admin);
      expect(synced).toEqual(['2026-03-02']);
    });
  });
});
