import {
  extractYearFromFilename,
  daysBetween,
  parseDateRange,
  extractSongs,
} from './wt-parser';

describe('wt-parser', () => {
  describe('extractYearFromFilename', () => {
    it('extracts year from Watchtower study edition filename', () => {
      expect(extractYearFromFilename('w_U_202603.epub')).toBe(2026);
    });

    it('extracts year from Public edition (wp_) filename', () => {
      expect(extractYearFromFilename('wp_E_202509.epub')).toBe(2025);
    });

    it('falls back to current year when pattern does not match', () => {
      expect(extractYearFromFilename('random.epub')).toBe(
        new Date().getFullYear(),
      );
    });
  });

  describe('daysBetween', () => {
    it('returns 0 for same date', () => {
      expect(daysBetween('2026-05-11', '2026-05-11')).toBe(0);
    });

    it('returns 1 for consecutive days', () => {
      expect(daysBetween('2026-05-11', '2026-05-12')).toBe(1);
    });

    it('returns 6 for a typical study-week range (Mon -> Sun)', () => {
      expect(daysBetween('2026-05-11', '2026-05-17')).toBe(6);
    });

    it('handles cross-month boundary', () => {
      expect(daysBetween('2026-05-29', '2026-06-04')).toBe(6);
    });

    it('handles cross-year boundary', () => {
      expect(daysBetween('2025-12-29', '2026-01-04')).toBe(6);
    });

    it('returns negative for reversed range', () => {
      expect(daysBetween('2026-05-17', '2026-05-11')).toBe(-6);
    });
  });

  describe('parseDateRange', () => {
    it('parses same-month uppercase range with year', () => {
      expect(parseDateRange('4-10 МАЯ 2026')).toEqual({
        start: '2026-05-04',
        end: '2026-05-10',
        year: 2026,
      });
    });

    it('parses cross-month range with year', () => {
      expect(parseDateRange('29 ИЮНЯ - 5 ИЮЛЯ 2026')).toEqual({
        start: '2026-06-29',
        end: '2026-07-05',
        year: 2026,
      });
    });

    it('handles year crossover (Dec -> Jan, end year incremented)', () => {
      expect(parseDateRange('28 ДЕКАБРЯ - 3 ЯНВАРЯ 2025')).toEqual({
        start: '2025-12-28',
        end: '2026-01-03',
        year: 2025,
      });
    });

    it('normalizes em-dash to hyphen', () => {
      expect(parseDateRange('4—10 МАЯ 2026')).toEqual({
        start: '2026-05-04',
        end: '2026-05-10',
        year: 2026,
      });
    });

    it('accepts lowercase month names', () => {
      expect(parseDateRange('4-10 мая 2026')).toEqual({
        start: '2026-05-04',
        end: '2026-05-10',
        year: 2026,
      });
    });

    it('returns null for unparseable text', () => {
      expect(parseDateRange('random text 2026')).toBeNull();
    });

    it('returns null without year (mandatory for WT)', () => {
      expect(parseDateRange('4-10 МАЯ')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseDateRange('')).toBeNull();
    });
  });

  describe('extractSongs', () => {
    it('finds multiple song numbers in text', () => {
      expect(
        extractSongs('Песня 21 в начале и Песня 153 в конце'),
      ).toEqual([21, 153]);
    });

    it('handles uppercase ПЕСНЯ', () => {
      expect(extractSongs('ПЕСНЯ 7')).toEqual([7]);
    });

    it('handles "Песни" (plural form)', () => {
      expect(extractSongs('Песни 1 в начале')).toEqual([1]);
    });

    it('returns empty array when no songs mentioned', () => {
      expect(extractSongs('текст без песен')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(extractSongs('')).toEqual([]);
    });

    it('filters out zero', () => {
      expect(extractSongs('Песня 0 и Песня 5')).toEqual([5]);
    });
  });
});
