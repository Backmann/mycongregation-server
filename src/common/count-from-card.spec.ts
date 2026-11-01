import { notBeforeTheCard } from '../common/count-from-card';

describe('notBeforeTheCard — counting begins no earlier than a new card', () => {
  it('a card made from 1 November 2026 starts with its own month', () => {
    const made = new Date('2026-11-05T10:00:00Z');
    expect(notBeforeTheCard('2005-05', made)).toBe('2026-11');
    expect(notBeforeTheCard(null, made)).toBe('2026-11');
  });

  it('a later start of his own still wins', () => {
    expect(notBeforeTheCard('2027-01', new Date('2026-11-05T10:00:00Z'))).toBe(
      '2027-01',
    );
  });

  it('cards made before that day keep the rule they were judged by', () => {
    const old = new Date('2026-10-31T23:00:00Z');
    expect(notBeforeTheCard('2005-05', old)).toBe('2005-05');
    expect(notBeforeTheCard(null, old)).toBeNull();
    expect(notBeforeTheCard('2005-05', null)).toBe('2005-05');
  });
});
