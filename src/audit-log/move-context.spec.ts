import { moveContext } from './journal.service';

describe('the journal names a moved meeting by itself', () => {
  const snap = JSON.stringify({
    weekStartDate: '2026-11-09',
    eventType: 'midweek',
    date: '2026-11-12',
    time: '18:30',
    address: null,
  });

  it('a move made or changed: from what it became', () => {
    expect(
      moveContext({
        entityType: 'meeting_move',
        afterJson: snap,
        beforeJson: null,
      }),
    ).toEqual({ date: '2026-11-09', eventType: 'midweek' });
  });

  it('a move taken back: from what it was, the row being gone', () => {
    expect(
      moveContext({
        entityType: 'meeting_move',
        afterJson: null,
        beforeJson: snap,
      }),
    ).toEqual({ date: '2026-11-09', eventType: 'midweek' });
  });

  it('not for other entries', () => {
    expect(
      moveContext({ entityType: 'cart_slot', afterJson: snap }),
    ).toBeNull();
  });
});
