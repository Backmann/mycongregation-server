import { ConductAveragesService } from './conduct-averages.service';
import type { ConductAverage } from '../entities/conduct-average.entity';

function build() {
  const rows: ConductAverage[] = [];
  const averages = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<ConductAverage> }) =>
        rows.find(
          (r) =>
            r.congregationId === where.congregationId &&
            r.eventType === where.eventType &&
            r.measure === where.measure,
        ) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: Partial<ConductAverage> }) =>
      rows.filter(
        (r) =>
          r.congregationId === where.congregationId &&
          r.eventType === where.eventType,
      ),
    ),
    create: jest.fn(
      (x: Partial<ConductAverage>) => ({ ...x }) as ConductAverage,
    ),
    save: jest.fn(async (x: ConductAverage) => {
      if (!rows.includes(x)) rows.push(x);
      return x;
    }),
  };
  const assignments = {
    find: jest.fn(async () => [
      { id: 'a-close', partTitle: 'Песня 141 и молитва' },
    ]),
  };
  const songs = {
    find: jest.fn(async () => [{ number: 141, durationSec: 143 }]),
  };
  const service = new ConductAveragesService(
    averages as never,
    assignments as never,
    songs as never,
  );
  return { service, rows };
}

const closing = {
  key: 'midweek_closing_prayer',
  assignmentId: 'a-close',
  publisherIds: [],
  plannedSec: 300,
  actualSec: 233,
  counselSec: null,
  startSec: 2730,
};

describe("the forecast's numbers, kept per congregation (R-76)", () => {
  it("THE CASE: a saved meeting puts its prayer in — the song's length from the catalogue", async () => {
    const { service } = build();
    await service.record('c1', '2026-11-23', 'midweek' as never, [closing]);
    const got = await service.read('c1', 'midweek' as never);
    expect(got.prayer).toBe(90);
    expect(got.meetings).toBe(1);
    expect(got.walk).toBeNull();
  });

  it('«Это была проба» takes that week out again', async () => {
    const { service } = build();
    await service.record('c1', '2026-11-23', 'midweek' as never, [closing]);
    await service.forget('c1', '2026-11-23', 'midweek' as never);
    expect((await service.read('c1', 'midweek' as never)).prayer).toBeNull();
  });

  it('another congregation, or the weekend, learns nothing from it', async () => {
    const { service } = build();
    await service.record('c1', '2026-11-23', 'midweek' as never, [closing]);
    expect((await service.read('c2', 'midweek' as never)).prayer).toBeNull();
    expect((await service.read('c1', 'weekend' as never)).prayer).toBeNull();
  });

  it("only numbers are kept: weeks and seconds, nobody's name or id", async () => {
    const { service, rows } = build();
    await service.record('c1', '2026-11-23', 'midweek' as never, [
      { ...closing, publisherIds: ['p-secret'] },
    ]);
    expect(JSON.stringify(rows.map((r) => r.values))).not.toContain('p-secret');
    expect(
      rows.every((r) =>
        r.values.every((v) => Object.keys(v).join() === 'week,v'),
      ),
    ).toBe(true);
  });
});
