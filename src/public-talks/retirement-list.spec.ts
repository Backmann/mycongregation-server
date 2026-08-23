import { parseRetirementList } from './retirement-list';

/**
 * Reading the instruction as it actually arrives.
 *
 * The whole paragraph is pasted, because retyping thirty numbers is thirty
 * chances to be one out — and being one out means a brother prepares a talk
 * he must not give.
 */
describe('parseRetirementList', () => {
  const real =
    'Планы речей, которые больше не используются. Ниже приведены планы 45-' +
    'минутных публичных речей, которые больше не используются, поэтому их не ' +
    'следует преподносить, начиная с 1 сентября 2026 года: 84, 85, 87, 92, 94, ' +
    '97, 105, 106, 109, 117, 119, 120, 124, 126, 139, 141, 144, 145, 148, 149, ' +
    '151, 154, 155, 157, 158, 163, 164, 165, 167 и 168.';

  it('reads the real instruction, all thirty of them', () => {
    const out = parseRetirementList(real);

    expect(out.numbers).toEqual([
      84, 85, 87, 92, 94, 97, 105, 106, 109, 117, 119, 120, 124, 126, 139, 141,
      144, 145, 148, 149, 151, 154, 155, 157, 158, 163, 164, 165, 167, 168,
    ]);
  });

  it('does not mistake «45-минутных» for a talk', () => {
    // It stands BEFORE the colon, in the sentence that explains the rule. A
    // plain search for numbers would retire talk 45 — one that is still given.
    expect(parseRetirementList(real).numbers).not.toContain(45);
  });

  it('does not mistake the year for a talk', () => {
    expect(parseRetirementList(real).numbers).not.toContain(2026);
    // Nor the day of the month, which sits before the colon as well.
    expect(parseRetirementList(real).numbers).not.toContain(1);
  });

  it('takes the last number, joined by a word rather than a comma', () => {
    // «167 и 168» — in German «und», in English «and». Splitting on commas
    // would quietly drop the last talk in every such list.
    expect(parseRetirementList(real).numbers).toContain(168);
  });

  it('reads a bare list with no sentence at all', () => {
    expect(parseRetirementList('84, 85, 87').numbers).toEqual([84, 85, 87]);
  });

  it('reads numbers separated by newlines', () => {
    expect(parseRetirementList('84\n85\n87').numbers).toEqual([84, 85, 87]);
  });

  it('sorts them, whatever order they were written in', () => {
    expect(parseRetirementList('92, 84, 87').numbers).toEqual([84, 87, 92]);
  });

  it('names a number written twice instead of counting it twice', () => {
    const out = parseRetirementList('84, 85, 84');

    expect(out.numbers).toEqual([84, 85]);
    expect(out.duplicates).toEqual([84]);
  });

  it('answers nothing to a paste with no numbers in it', () => {
    expect(parseRetirementList('никаких номеров здесь нет').numbers).toEqual(
      [],
    );
  });

  it('ignores anything outside the range a talk number can have', () => {
    expect(parseRetirementList('84, 1200, 0').numbers).toEqual([84]);
  });
});
