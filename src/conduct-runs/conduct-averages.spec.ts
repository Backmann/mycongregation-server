import type { ConductRunSegment } from '../entities/conduct-run.entity';
import {
  KEEP_MEETINGS,
  measuresOf,
  median,
  sealWeek,
  withWeek,
} from './conduct-averages';
import type { ConductAverageValue } from '../entities/conduct-average.entity';
import { songNumber } from '../talk-exchange/week-songs';

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

  it("walks and counsels are the meeting's middle ones", () => {
    const m = measuresOf(run, songSec);
    expect(m.walk).toBe(Math.round((16 + 17) / 2)); // 15 16 17 18 → 17
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
    let v: ConductAverageValue[] = [];
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

  it('nobody walked: gaps of 0–2 s from seconds rounded one by one are not walks', () => {
    // The same brother carrying on, the song after the chairman's words: the
    // app rounds start, part and counsel apart, so «no gap» reads 0, 1 or 2.
    const m = measuresOf(
      [
        seg('treasures_talk', 0, 600), // walk 15
        seg('spiritual_gems', 615, 600), // walk 15
        seg('bible_reading', 1216, 240, 74), // gap 1
        seg('apply_yourself_1', 1532, 200, 87), // gap 2
        seg('apply_yourself_2', 1821, 200), // gap 2
        seg('living_christians_1', 2022, 300), // gap 1
      ],
      songSec,
    );
    expect(m.walk).toBe(15);
  });

  it('a pause is not a walk: over 90 s dropped, a short one does not move the middle', () => {
    const m = measuresOf(
      [
        seg('treasures_talk', 0, 600),
        seg('spiritual_gems', 616, 600), // walk 16
        seg('bible_reading', 1300, 240), // 84 s: a pause
        seg('apply_yourself_1', 1556, 200), // walk 16
        seg('apply_yourself_2', 1774, 200), // walk 18
        seg('living_christians_1', 2200, 300), // 226 s: a pause, dropped
      ],
      songSec,
    );
    // 16 16 18 84 → 17; their mean would be 34.
    expect(m.walk).toBe(17);
  });

  it('a part with no start leaves no end: the next gap is not measured from an older part', () => {
    const m = measuresOf(
      [
        seg('treasures_talk', 0, 600),
        { ...seg('spiritual_gems', 0, 600), startSec: null },
        seg('bible_reading', 650, 240), // 50 s after treasures_talk, not a walk
      ],
      songSec,
    );
    expect(m.walk).toBeUndefined();
  });

  it("the overseer's week teaches no prayer: he chooses the closing song", () => {
    const visit = [
      seg('midweek_closing_words', 2400, 180),
      seg('co_service_talk', 2595, 1800),
      seg('midweek_closing_prayer', 4410, 233),
    ];
    expect(measuresOf(visit, songSec).prayer).toBeUndefined();
    const weekend = [
      seg('weekend_song', 2000, 193),
      seg('co_concluding_talk', 4000, 1800),
      seg('weekend_closing_prayer', 5800, 300),
    ];
    const m = measuresOf(weekend, () => 173);
    expect(m.prayer).toBeUndefined();
    expect(m.songLead).toBe(20); // the song before the study is still his own
  });

  it("the midweek closing row's title gives its song", () => {
    expect(songNumber('Заключительные слова | Песня 141 и молитва')).toBe(141);
  });

  it('after its result is gone a number keeps no week, and stays in the middle', () => {
    let v: ConductAverageValue[] = [];
    v = withWeek(v, '2026-11-16', 80);
    v = withWeek(v, '2026-11-23', 90);
    v = sealWeek(v, '2026-11-16');
    expect(v).toEqual([{ v: 80 }, { week: '2026-11-23', v: 90 }]);
    // A sealed number cannot be taken back by a week any more.
    expect(withWeek(v, '2026-11-16', null)).toHaveLength(2);
    expect(median(v)).toBe(85);
  });

  it('the middle number: one odd meeting does not move it', () => {
    const w = (xs: number[]) => xs.map((v, i) => ({ week: `w${i}`, v }));
    expect(median(w([90, 85, 95, 600]))).toBe(93);
    expect(median(w([90, 85, 95]))).toBe(90);
    expect(median([])).toBeNull();
  });
});
