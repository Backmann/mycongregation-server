/**
 * The numbers in an instruction about talks that are no longer to be given.
 *
 * It arrives as prose, not as data:
 *
 *   «Ниже приведены планы 45-минутных публичных речей, которые больше не
 *    используются, поэтому их не следует преподносить, начиная с 1 сентября
 *    2026 года: 84, 85, 87, 92, … 167 и 168.»
 *
 * So the whole paragraph is pasted and the numbers are taken out of it. Thirty
 * numbers retyped by hand is thirty chances to be one out, and being one out
 * here means a brother prepares a talk he must not give.
 *
 * WHY NOT A PLAIN «split on commas». The list ends «167 и 168» — the last
 * separator is a word, and in German or English it is another word. And the
 * sentence before the colon contains «45» — a number that must not be taken
 * for a talk. Hence: only what follows the colon, and only standalone numbers.
 */
export interface ParsedRetirement {
  numbers: number[];
  /** Numbers that appeared twice — worth saying, not worth failing over. */
  duplicates: number[];
}

export function parseRetirementList(text: string): ParsedRetirement {
  // Everything after the last colon, when there is one: the sentence before it
  // explains the rule and may carry numbers of its own («45-минутных»).
  const afterColon = text.includes(':')
    ? text.slice(text.lastIndexOf(':') + 1)
    : text;

  const seen = new Set<number>();
  const numbers: number[] = [];
  const duplicates: number[] = [];

  // Standalone runs of digits: «84» yes, «45-минутных» no, «2026» yes but it
  // cannot survive the range check below.
  for (const m of afterColon.matchAll(/\d+/g)) {
    const n = parseInt(m[0], 10);
    // A talk number, not a year and not a page reference.
    if (!Number.isFinite(n) || n < 1 || n > 999) continue;
    if (seen.has(n)) {
      if (!duplicates.includes(n)) duplicates.push(n);
      continue;
    }
    seen.add(n);
    numbers.push(n);
  }

  numbers.sort((a, b) => a - b);
  return { numbers, duplicates };
}
