import type { ConductRunSegment } from '../entities/conduct-run.entity';
import {
  KEEP_MEETINGS,
  measuresOf,
  median,
  withWeek,
} from './conduct-averages';

const seg = (
  key: string,
  startSec: number,
  actualSec: number,
  counselSec: number | null = null,
  assignmentId: string | null = key,
): ConductRunSegment => ({
  key,
  assignmentId,
  publisherIds: [],
  plannedSec: 0,
  actualSec,
  counselSec,
  startSec,
});

describe('what a finished meeting teaches the forecast (R-76, R-77)', () => {
  // Shaped like 18.11: song 90 in the middle (2:56 recorded, 3:15 run),
  // song 141 at the end (2:23 recorded, 3:53 run with the prayer).
  const SONGS: Record<string, number> = {
    mid_song: 176,
    midweek_closing_prayer: 143,
    midweek_opening_prayer: 141,
  };
  const songSec = (s: ConductRunSegment) => SONGS[s.key] ?? null;
  const run = [
    seg('midweek_opening_prayer', 0, 172),
    seg('midweek_opening_words', 172, 102),
    seg('treasures_talk', 290, 693), // walked 16 s
    seg('bible_reading', 1000, 240, 75), // walked 17 s
    seg('apply_yourself_1', 1330, 200, 87), // walked 15 s
    seg('mid_song', 1617, 195),
    seg('living_christians_1', 1830, 900), // walked 18 s
    seg('midweek_closing_prayer', 2730, 233),
  ];

  it('THE CASE: the prayer is the closing segment minus its song; the lead-in, the middle one minus its song', () => {
    const m = measuresOf(run, songSec);
    expect(m.prayer).toBe(233 - 143); // 1:30
    expect(m.songLead).toBe(195 - 176); // 0:19, as on 18.11
  });

  it('the opening segment teaches no prayer: «Начать» comes after the song began (R-78)', () => {
    const onlyOpening = [seg('midweek_opening_prayer', 0, 172)];
    expect(measuresOf(onlyOpening, songSec).prayer).toBeUndefined();
  });

  it("walks and counsels are the meeting's means", () => {
    const m = measuresOf(run, songSec);
    expect(m.walk).toBe(Math.round((16 + 17 + 15 + 18) / 4)); // 17
    expect(m.counsel).toBe(Math.round((75 + 87) / 2));
  });

  it('a slip of a finger is not a habit: out-of-range numbers are dropped', () => {
    const odd = [
      seg('treasures_talk', 0, 600),
      seg('bible_reading', 900, 240, 2), // counsel 2 s: a double tap
      seg('midweek_closing_prayer', 1142, 143 + 900, null), // a prayer of 15 min: left running
    ];
    const m = measuresOf(odd, songSec);
    expect(m.walk).toBeUndefined(); // 300 s gap: not a walk
    expect(m.counsel).toBeUndefined();
    expect(m.prayer).toBeUndefined();
  });

  it('a song with no known length teaches nothing about its prayer', () => {
    expect(
      measuresOf([seg('midweek_closing_prayer', 0, 230)], () => null).prayer,
    ).toBeUndefined();
  });

  it('twelve meetings are kept, the same week replaced, a forgotten week removed', () => {
    let v = [] as { week: string; v: number }[];
    for (let i = 1; i <= 14; i++)
      v = withWeek(v, `2026-${String(i).padStart(2, '0')}-05`, i);
    expect(v).toHaveLength(KEEP_MEETINGS);
    expect(v[0].week).toBe('2026-03-05');
    v = withWeek(v, '2026-14-05', 99);
    expect(v.filter((x) => x.week === '2026-14-05')).toEqual([
      { week: '2026-14-05', v: 99 },
    ]);
    v = withWeek(v, '2026-14-05', null);
    expect(v.find((x) => x.week === '2026-14-05')).toBeUndefined();
  });

  it('the middle number: one odd meeting does not move it', () => {
    const w = (xs: number[]) => xs.map((v, i) => ({ week: `w${i}`, v }));
    expect(median(w([90, 85, 95, 600]))).toBe(93);
    expect(median(w([90, 85, 95]))).toBe(90);
    expect(median([])).toBeNull();
  });
});
