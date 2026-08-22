import { parseDateRange } from './wt-parser';

/**
 * The study article for the week that crosses into the new year.
 *
 * Same fault as the workbook's, in a second copy of the same idea: the article
 * headed «28 ДЕКАБРЯ 2026 ГОДА — 3 ЯНВАРЯ 2027 ГОДА» matched no pattern, was
 * skipped without a word, and the weekend meeting of that week came out empty.
 *
 * Found in w_U_202610.epub, which the parser reported as holding three study
 * articles when it holds four.
 */
describe('parseDateRange — the new-year week', () => {
  it('reads the full form with both years', () => {
    expect(parseDateRange('28 ДЕКАБРЯ 2026 ГОДА — 3 ЯНВАРЯ 2027 ГОДА')).toEqual(
      { start: '2026-12-28', end: '2027-01-03', year: 2026 },
    );
  });

  it('reports the year the week BEGINS in', () => {
    // The issue belongs to the year it starts in; a study article that ends in
    // January is still part of the December programme.
    expect(
      parseDateRange('28 ДЕКАБРЯ 2026 года - 3 ЯНВАРЯ 2027 года')?.year,
    ).toBe(2026);
  });

  it('still reads the two forms that always worked', () => {
    expect(parseDateRange('29 ИЮНЯ - 5 ИЮЛЯ 2026')).toEqual({
      start: '2026-06-29',
      end: '2026-07-05',
      year: 2026,
    });
    expect(parseDateRange('4-10 МАЯ 2026')).toEqual({
      start: '2026-05-04',
      end: '2026-05-10',
      year: 2026,
    });
  });

  it('answers nothing to a heading with no dates in it', () => {
    expect(parseDateRange('СОДЕРЖАНИЕ')).toBeNull();
  });
});
