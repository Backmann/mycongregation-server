import { isRevertable, REVERTABLE_FIELDS } from './revertable';

/**
 * The journal list and the revert service ask the same question of the same
 * constant, so the button appears exactly where it will work.
 */
describe('isRevertable', () => {
  it('says yes to an edit that touched a field which can come back', () => {
    expect(isRevertable('UPDATE', 'assignment', false, ['partTitle'])).toBe(
      true,
    );
  });

  it('says no to anything that was not an edit', () => {
    expect(isRevertable('DELETE', 'assignment', false, ['partTitle'])).toBe(
      false,
    );
    expect(isRevertable('CREATE', 'assignment', false, ['partTitle'])).toBe(
      false,
    );
  });

  it('says no when the values were erased at a person\u2019s request', () => {
    expect(isRevertable('UPDATE', 'assignment', true, ['partTitle'])).toBe(
      false,
    );
  });

  it('says no for a kind the registry does not cover', () => {
    // A report has its own closing rules; a duty is set by its own method.
    expect(isRevertable('UPDATE', 'service_report', false, ['hours'])).toBe(
      false,
    );
    expect(isRevertable('UPDATE', 'duty', false, ['publisherId'])).toBe(false);
  });

  it('says no when the edit touched nothing on the list', () => {
    // A publisher's status is computed from reports and has its own override
    // switch — putting an old value back would lie about where it came from.
    expect(isRevertable('UPDATE', 'publisher', false, ['status'])).toBe(false);
  });

  it('keeps status out of what a publisher can have put back', () => {
    expect(REVERTABLE_FIELDS.publisher).not.toContain('status');
    expect(REVERTABLE_FIELDS.publisher).not.toContain(
      'statusManuallyOverridden',
    );
  });
});
