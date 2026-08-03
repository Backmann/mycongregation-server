import { CongregationClock } from '../congregation-clock.service';

/**
 * A real CongregationClock over a stub repository.
 *
 * Deliberately the real class rather than a hand-written fake: the thing worth
 * testing is that a service asks the clock and uses the answer, and a fake
 * that returns dates by its own arithmetic would agree with the service even
 * when both are wrong. Only the row lookup is replaced.
 */
export function clockStub(timezone = 'Europe/Berlin'): CongregationClock {
  return new CongregationClock({
    findOne: async () => ({ id: 'cong-1', timezone }),
  } as any);
}
