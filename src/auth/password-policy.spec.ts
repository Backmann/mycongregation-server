import { passwordProblem, PASSWORD_MIN_LENGTH } from './password-policy';

/**
 * The bar is length plus «not what everyone already uses» — deliberately not
 * a demand for a capital, a digit and a symbol. Those rules produce
 * `Password1!` and a note under the keyboard.
 */
describe('passwordProblem', () => {
  it('accepts a long ordinary password', () => {
    expect(passwordProblem('осенний дождь идёт')).toBeNull();
    expect(passwordProblem('correct horse battery')).toBeNull();
  });

  it('refuses anything shorter than the floor', () => {
    expect(passwordProblem('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      'tooShort',
    );
  });

  it('refuses what an attacker tries first', () => {
    expect(passwordProblem('password123')).toBe('tooCommon');
    expect(passwordProblem('PASSWORD123')).toBe('tooCommon');
    expect(passwordProblem('qwertyuiop')).toBe('tooCommon');
  });

  it('refuses a long password made of nothing', () => {
    // Passes the length rule and is worth exactly one guess.
    expect(passwordProblem('aaaaaaaaaaaa')).toBe('tooRepetitive');
    // '1234567890' is on the common list as well; the walk-up rule catches
    // the ones that are not.
    expect(passwordProblem('01234567891')).toBe('tooRepetitive');
  });

  it('refuses the address as its own password', () => {
    expect(passwordProblem('brother@example.org', 'brother@example.org')).toBe(
      'looksLikeEmail',
    );
    expect(passwordProblem('brothername', 'brothername@example.org')).toBe(
      'looksLikeEmail',
    );
  });

  it('does not mind a short local part appearing in a good password', () => {
    // «ivan» is four characters; a password merely containing it is fine —
    // only being it is not.
    expect(passwordProblem('ivan и его гитара', 'ivan@example.org')).toBeNull();
  });
});
