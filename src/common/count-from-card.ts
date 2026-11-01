/**
 * Cards made from this day on (Lionel, 1 November 2026) are not judged on
 * the months before they were made: counting begins no earlier than the
 * card. Without it a brother who moved in — baptized years ago, no reports
 * here yet — was «six closed months silent» the night his card was made,
 * inactive, and so out of every list but the elders'. Cards made before this
 * day keep the rule they were judged by, so nobody's standing moves today.
 * A person entered later who is already inactive on paper is marked so by
 * hand, until the card has its own «in our congregation since» date.
 */
export const COUNT_FROM_CARD_SINCE = '2026-11-01';

export function notBeforeTheCard(
  earliest: string | null,
  createdAt: Date | null | undefined,
): string | null {
  if (!createdAt || isNaN(createdAt.getTime())) return earliest;
  if (createdAt.toISOString().slice(0, 10) < COUNT_FROM_CARD_SINCE)
    return earliest;
  const made = createdAt.toISOString().slice(0, 7);
  return earliest !== null && earliest > made ? earliest : made;
}
