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
  const build = (weeks: string[], incomingCount = [0, 3]) => {
    const synced: string[] = [];
    const counts = [...incomingCount];
    const service = Object.create(
      TalkExchangeService.prototype,
    ) as TalkExchangeService;
    Object.assign(service, {
      assignmentRepo: {
        find: jest.fn(async () => weeks.map((w) => ({ weekStartDate: w }))),
      },
      repo: { count: jest.fn(async () => counts.shift() ?? 0) },
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

    const out = await service.rebuildFromProgramme('c1', '2026-03-01');

    expect(synced).toEqual(['2026-03-02', '2026-03-09']);
    expect(out.weeks).toBe(2);
  });

  it('reports how many entries the journal gained', async () => {
    const { service } = build(['2026-03-02'], [0, 5]);

    await expect(
      service.rebuildFromProgramme('c1', '2026-03-01'),
    ).resolves.toMatchObject({ created: 5 });
  });

  it('reports nothing gained when the journal already agreed', async () => {
    // Idempotent by construction: it calls the same one-week sync used
    // everywhere else, so a week that already agrees is left alone.
    const { service } = build(['2026-03-02'], [4, 4]);

    await expect(
      service.rebuildFromProgramme('c1', '2026-03-01'),
    ).resolves.toMatchObject({ created: 0 });
  });

  it('asks only for weeks from the given date onwards', async () => {
    const { service } = build([]);

    await service.rebuildFromProgramme('c1', '2026-03-01');

    const where = (
      service as unknown as { assignmentRepo: { find: jest.Mock } }
    ).assignmentRepo.find.mock.calls[0][0].where as {
      weekStartDate: { value: string };
    };
    expect(where.weekStartDate.value).toBe('2026-03-01');
  });
});
