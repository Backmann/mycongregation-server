import {
  addMonth,
  carryKey,
  carryKeyPublisher,
  keptSheetsOf,
  placeLate,
  type KeptSheet,
} from './late-carry';

const sheet = (reporters: string[], carried: string[] = []): KeptSheet => ({
  reporters: new Set(reporters),
  carried: new Set(carried),
});

describe('late reports go into the next sheet (instruction, point 14)', () => {
  it('a report of a month nobody has sent yet is simply on time', () => {
    expect(placeLate('b', '2026-09', new Map())).toEqual({
      late: false,
      into: null,
      kept: false,
    });
  });

  it('a report the sent sheet counted is on time', () => {
    const sheets = new Map([['2026-09', sheet(['a', 'b'])]]);
    expect(placeLate('b', '2026-09', sheets).late).toBe(false);
  });

  it('a report handed in after its month was sent goes to the next month', () => {
    const sheets = new Map([['2026-09', sheet(['a'])]]);
    expect(placeLate('b', '2026-09', sheets)).toEqual({
      late: true,
      into: '2026-10',
      kept: false,
    });
  });

  it('when the next month is already sent too, it waits for the first open one', () => {
    // September and October sent; his September report came in November.
    const sheets = new Map([
      ['2026-09', sheet(['a'])],
      ['2026-10', sheet(['a'])],
    ]);
    expect(placeLate('b', '2026-09', sheets).into).toBe('2026-11');
  });

  it('once a sheet took it in, it stays there — counted in exactly one sheet', () => {
    const sheets = new Map([
      ['2026-09', sheet(['a'])],
      ['2026-10', sheet(['a'], [carryKey('b', '2026-09')])],
      ['2026-11', sheet(['a'])],
    ]);
    expect(placeLate('b', '2026-09', sheets)).toEqual({
      late: true,
      into: '2026-10',
      kept: true,
    });
  });

  it('sheets kept before the rule took no late report in: an old one went into no sheet', async () => {
    // June to September were kept before 30 October 2026. A June report
    // came in on 25 July — July and the rest went without it. It must not
    // land on October's S-1 now.
    const at = (d: string) => new Date(`${d}T10:00:00Z`);
    const sheets = new Map([
      ['2026-06', { ...sheet(['a']), keptAt: at('2026-07-19') }],
      ['2026-07', { ...sheet(['a']), keptAt: at('2026-08-19') }],
      ['2026-08', { ...sheet(['a']), keptAt: at('2026-09-19') }],
      ['2026-09', { ...sheet(['a']), keptAt: at('2026-10-19') }],
    ]);
    expect(placeLate('b', '2026-06', sheets, at('2026-07-25'))).toEqual({
      late: true,
      into: null,
      kept: false,
      missed: true,
    });
    // A September report that came in after September was sent still goes
    // into October, sheet kept before the rule or not.
    expect(placeLate('b', '2026-09', sheets, at('2026-10-25'))).toEqual({
      late: true,
      into: '2026-10',
      kept: false,
    });
    // And an August one handed in after September was sent: into October.
    expect(placeLate('b', '2026-08', sheets, at('2026-10-25')).into).toBe(
      '2026-10',
    );
  });

  it('the year turns over like any other month', () => {
    const sheets = new Map([['2026-12', sheet([])]]);
    expect(placeLate('b', '2026-12', sheets).into).toBe('2027-01');
    expect(addMonth('2026-08', 1)).toBe('2026-09');
    expect(addMonth('2027-01', -12)).toBe('2026-01');
  });

  it('reads a kept sheet: counted lines, every report that was in, and what it carried', () => {
    const sheets = keptSheetsOf([
      {
        period: '2026-09',
        createdAt: new Date('2026-10-19T10:00:00Z'),
        members: {
          active: ['a', 'b', 'c', 'z'],
          inactive: ['x'],
          'reported:none': ['a'],
          'reported:regular': ['c'],
          filed: ['a', 'c', 'd'],
          carried: ['e@2026-08'],
        },
      },
    ]);
    const sep = sheets.get('2026-09')!;
    // «Active» is not «reported»: z is active without a September report.
    expect([...sep.reporters].sort()).toEqual(['a', 'c', 'd']);
    expect([...sep.carried]).toEqual(['e@2026-08']);
    expect(carryKeyPublisher('e@2026-08')).toBe('e');
    expect(sep.keptAt).toEqual(new Date('2026-10-19T10:00:00Z'));
  });

  it('a sheet kept before «filed» existed knows its counted people only', () => {
    const sheets = keptSheetsOf([
      { period: '2026-08', members: { 'reported:none': ['a'] } },
      { period: '2026-07', members: null },
    ]);
    expect([...sheets.get('2026-08')!.reporters]).toEqual(['a']);
    expect(sheets.get('2026-07')!.reporters.size).toBe(0);
  });
});
