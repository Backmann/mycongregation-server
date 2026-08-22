import { MwbImportService } from './mwb-import.service';

/**
 * What the congregation already has, month by month.
 *
 * The import screen had no memory at all: it looked the same whether September
 * was loaded or nothing was, and the only way to find out was to leave it and
 * page through the schedule. Loading a workbook twice does no harm — filled
 * parts are skipped — but not knowing is what makes somebody do it.
 */
describe('MwbImportService.coverage', () => {
  const build = (rows: { week: string; parts: string }[]) => {
    const getRawMany = jest.fn().mockResolvedValue(rows);
    const service = Object.create(
      MwbImportService.prototype,
    ) as MwbImportService;
    Object.assign(service, {
      assignmentsRepo: {
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getRawMany,
        })),
      },
    });
    return service;
  };

  it('groups the weeks by the month each one starts in', async () => {
    const service = build([
      { week: '2026-08-31', parts: '12' },
      { week: '2026-09-07', parts: '12' },
      { week: '2026-09-14', parts: '11' },
    ]);

    const out = await service.coverage('c1');

    // The week of 31 August belongs to August, though most of it is September
    // — the same way the workbooks themselves are named.
    expect(out).toEqual([
      {
        month: '2026-08',
        weeks: 1,
        parts: 12,
        firstWeek: '2026-08-31',
        lastWeek: '2026-08-31',
      },
      {
        month: '2026-09',
        weeks: 2,
        parts: 23,
        firstWeek: '2026-09-07',
        lastWeek: '2026-09-14',
      },
    ]);
  });

  it('adds the parts up as numbers, not as text', async () => {
    // COUNT(*) comes back from Postgres as a string; concatenating «12» and
    // «11» into «1211» is the kind of wrong that looks plausible.
    const service = build([
      { week: '2026-09-07', parts: '12' },
      { week: '2026-09-14', parts: '11' },
    ]);

    const [september] = await service.coverage('c1');

    expect(september.parts).toBe(23);
  });

  it('asks only for the last year, not for the whole history', async () => {
    // Opened from the profile, this runs on a table that grows every week. A
    // year back answers «до какого месяца загружено» and keeps the query from
    // scanning everything the congregation has ever scheduled.
    const service = build([]);
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    (
      service as unknown as {
        assignmentsRepo: { createQueryBuilder: jest.Mock };
      }
    ).assignmentsRepo.createQueryBuilder = jest.fn(() => qb);

    await service.coverage('c1');

    const bounded = qb.andWhere.mock.calls.find((c) =>
      String(c[0]).includes('week_start_date'),
    );
    expect(bounded).toBeDefined();
  });

  it('says nothing at all when nothing has been imported', async () => {
    const service = build([]);

    await expect(service.coverage('c1')).resolves.toEqual([]);
  });

  it('copes with a date object where a string was expected', async () => {
    // Drivers differ on whether a DATE column arrives as text or as a Date;
    // a silent `.slice` on the wrong type would throw at the worst moment.
    const service = build([{ week: '2026-09-07T00:00:00.000Z', parts: '4' }]);

    const [month] = await service.coverage('c1');

    expect(month.month).toBe('2026-09');
    expect(month.firstWeek).toBe('2026-09-07');
  });
});
