import { In, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';

/**
 * The songs of a weekend, read from the programme (Lionel, 25 October 2026).
 *
 * The guest chooses the opening song himself and tells it in advance. The
 * congregation must make sure it is not one the Watchtower study sings the
 * same day — otherwise he is asked for another. The study's songs come into
 * the programme with the Watchtower import: the song before the study in
 * `weekend_song` («Песня 12»), the closing one in `weekend_closing_prayer`
 * («Песня 34 и молитва»). The opening song is `weekend_opening_song`, written
 * by SongPicker as «Песня N».
 */
export const OPENING_SONG_PART_KEY = 'weekend_opening_song';
const STUDY_SONG_KEYS = ['weekend_song', 'weekend_closing_prayer'] as const;

/** «Песня 12», «Песня 34 и молитва», «Song 7», «Lied 44» → the number. */
export function songNumber(title: string | null | undefined): number | null {
  if (!title) return null;
  const m = title.match(/(?:Песня|Song|Lied)\s*№?\s*(\d{1,3})/iu);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** How the programme writes a song: the same words SongPicker writes. */
export function songTitle(n: number): string {
  return `Песня ${n}`;
}

export interface WeekSongs {
  /** The opening song in the programme, when it holds one. */
  opening: number | null;
  /** The Watchtower study's songs that weekend, in the programme's order. */
  study: number[];
}

/** The weekend songs of each week asked, from its live programme rows. */
export async function weekSongs(
  assignments: Repository<Assignment>,
  tenantId: string,
  weeks: string[],
): Promise<Map<string, WeekSongs>> {
  const out = new Map<string, WeekSongs>();
  if (weeks.length === 0) return out;
  const rows = await assignments.find({
    where: {
      congregationId: tenantId,
      weekStartDate: In([...new Set(weeks)]),
      partKey: In([OPENING_SONG_PART_KEY, ...STUDY_SONG_KEYS]),
    },
    select: {
      id: true,
      weekStartDate: true,
      partKey: true,
      partTitle: true,
      partOrder: true,
    },
    order: { partOrder: 'ASC' },
  });
  for (const r of rows) {
    const week = String(r.weekStartDate).slice(0, 10);
    const w = out.get(week) ?? { opening: null, study: [] };
    const n = songNumber(r.partTitle);
    if (n !== null) {
      if (r.partKey === OPENING_SONG_PART_KEY) w.opening = n;
      else if (!w.study.includes(n)) w.study.push(n);
    }
    out.set(week, w);
  }
  return out;
}
