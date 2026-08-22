import { parseWeekRange } from './mwb-parser';

/**
 * The week that crosses into the new year.
 *
 * Every other week in a workbook is written short — «21—27 ДЕКАБРЯ» — and this
 * one is written out in full, with both years and the word «года», because it
 * belongs to two of them. It matched none of the patterns and was dropped in
 * silence: once a year, the last week of December simply failed to import, and
 * the schedule showed an empty week nobody could explain.
 *
 * Found on 22 August 2026 in mwb_U_202611.epub, where week 9 of 9 was missing
 * and the parser reported no error at all.
 */
describe('parseWeekRange — the new-year week', () => {
  it('reads the full form with both years', () => {
    expect(
      parseWeekRange('28 ДЕКАБРЯ 2026 ГОДА - 3 ЯНВАРЯ 2027 ГОДА', 2026),
    ).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  it('takes the years from the TEXT, not from the file name', () => {
    // The file is named for 2026; the week ends in 2027, and the publication
    // says so. Believing the file name would put the end date a year out.
    expect(
      parseWeekRange('28 ДЕКАБРЯ 2026 ГОДА - 3 ЯНВАРЯ 2027 ГОДА', 1999),
    ).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  it('reads it with an em dash, as the publication actually writes it', () => {
    expect(
      parseWeekRange('28 ДЕКАБРЯ 2026 года — 3 ЯНВАРЯ 2027 года', 2026),
    ).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  it('reads it without the word «года» at all', () => {
    expect(parseWeekRange('28 ДЕКАБРЯ 2026 - 3 ЯНВАРЯ 2027', 2026)).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    });
  });

  it('still reads the ordinary forms', () => {
    // The new pattern is tried first, so the two that always worked are
    // asserted here as well: a fix that quietly breaks the common case is
    // worse than the bug it fixes.
    expect(parseWeekRange('21-27 ДЕКАБРЯ', 2026)).toEqual({
      start: '2026-12-21',
      end: '2026-12-27',
    });
    expect(parseWeekRange('30 НОЯБРЯ - 6 ДЕКАБРЯ', 2026)).toEqual({
      start: '2026-11-30',
      end: '2026-12-06',
    });
  });

  it('still turns December into January for the short cross-month form', () => {
    // «28 ДЕКАБРЯ - 3 ЯНВАРЯ» without years: the year has to be inferred, and
    // that inference is the one the new pattern replaces when it can.
    expect(parseWeekRange('28 ДЕКАБРЯ - 3 ЯНВАРЯ', 2026)).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    });
  });

  it('answers nothing to a heading that is not a week', () => {
    expect(parseWeekRange('СОДЕРЖАНИЕ', 2026)).toBeNull();
    expect(parseWeekRange('28 ДЕКАБРЯ 2026 ГОДА', 2026)).toBeNull();
  });
});
