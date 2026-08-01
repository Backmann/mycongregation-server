/**
 * Freeze the clock for a test — including `new Date()`.
 *
 * `jest.spyOn(Date, 'now')` does NOT do this: V8 builds `new Date()` from the
 * system clock directly and never calls `Date.now`, so code written the
 * ordinary way went on reading the real date while the test believed it had
 * set one. Those tests passed or failed by the calendar rather than by the
 * code — and on 1 August 2026 two of them duly started failing.
 *
 * Only the clock is faked; timers stay real, because these are service tests
 * with mocked repositories and faking setTimeout would change how unrelated
 * tests run for no benefit.
 */
export function setNow(ms: number): void {
  jest.useFakeTimers({
    now: ms,
    doNotFake: [
      'nextTick',
      'setImmediate',
      'setInterval',
      'setTimeout',
      'clearInterval',
      'clearTimeout',
      'queueMicrotask',
      'performance',
    ],
  });
}

/** Give the real clock back. Pair with setNow in afterEach. */
export function restoreNow(): void {
  jest.useRealTimers();
}
