import { historyKind, kindsOf } from './territory-history';

describe('territory history: naming the steps the journal kept', () => {
  const k = (
    action: string,
    d: Record<string, unknown> | null,
    type = 'territory_assignment',
  ) => historyKind(type, action, d);

  it('reads every shape a line ever wrote, old and new', () => {
    // Given out — as written since 11 November 2026.
    expect(
      k('CREATE', {
        number: 'A01',
        assignedOn: '2026-11-01',
        dueOn: '2027-03-01',
      }),
    ).toBe('given');
    // Handed on: old shape (no holders) and new.
    expect(k('CREATE', { transferredFrom: 'x', on: '2026-11-01' })).toBe(
      'transferred',
    );
    expect(
      k('CREATE', { transferredFrom: 'x', fromHolder: 'A', holder: 'B' }),
    ).toBe('transferred');
    expect(k('CREATE', { past: true, holder: 'A' })).toBe('past');
    expect(k('CREATE', { campaign: ['A01'], workedOn: '2026-11-01' })).toBe(
      'campaign',
    );
    expect(
      k('UPDATE', { completedOn: '2026-11-01', method: 'door_to_door' }),
    ).toBe('worked');
    expect(k('UPDATE', { returnedOn: '2026-11-01' })).toBe('returned');
    expect(k('UPDATE', { dueOn: '2026-12-01' })).toBe('extended');
    // A correction: the old shape (`after` = what was sent) and the new.
    expect(
      k('UPDATE', { before: {}, after: { completedOn: '2026-11-01' } }),
    ).toBe('corrected');
    expect(k('UPDATE', { correction: true, before: {}, after: {} })).toBe(
      'corrected',
    );
    expect(k('DELETE', { assignedOn: '2026-11-01', holder: 'A' })).toBe(
      'removed',
    );
  });

  it('keeps links, printing and meetings out of the desk', () => {
    expect(k('UPDATE', { link: 'created' })).toBe('quiet');
    expect(k('UPDATE', { printed: ['x'], withNoCalls: true })).toBe('quiet');
    expect(
      k('UPDATE', { meeting: 'm', droppedFrom: 't', date: '2026-11-01' }),
    ).toBe('quiet');
    expect(k('UPDATE', null)).toBe('quiet');
  });

  it('the territory itself is one kind; addresses, imports and settings are not shown', () => {
    expect(k('UPDATE', { outline: 'edit' }, 'territory')).toBe('territory');
    expect(k('UPDATE', {}, 'territory_boundary')).toBe('territory');
    expect(k('CREATE', {}, 'territory_no_call')).toBe('quiet');
    expect(k('CREATE', {}, 'territory_import')).toBe('quiet');
  });

  it("the re-cutting: what reaches the territories shows, the draft's own work does not", () => {
    for (const r of ['applied', 'unapplied', 'held', 'released']) {
      expect(k('UPDATE', { recut: r }, 'territory')).toBe('territory');
    }
    for (const r of [
      'measure',
      'proposal',
      'approved',
      'figures',
      'class',
      'suggested',
    ]) {
      expect(k('UPDATE', { recut: r }, 'territory')).toBe('quiet');
    }
  });

  it("filters by the screen's words; nonsense means everything", () => {
    expect(kindsOf('given')).toEqual(['given', 'transferred']);
    expect(kindsOf('given,back')).toEqual([
      'given',
      'transferred',
      'worked',
      'returned',
      'campaign',
    ]);
    expect(kindsOf('fixes')).toEqual(['corrected', 'removed', 'past']);
    expect(kindsOf('nothing')).toBeNull();
    expect(kindsOf(undefined)).toBeNull();
  });
});
