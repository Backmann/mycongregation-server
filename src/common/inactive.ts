import { PublisherStatus } from './enums/publisher-status.enum';

/**
 * An inactive publisher is given no task (Lionel, 31 October 2026:
 * «неактивные не могут быть задействованы в обязанностях или в программе»).
 * The ONE test every candidate list on the server asks. When a report comes
 * in, the status is recomputed at once and he is a candidate again.
 *
 * Whoever is told «not offered» is never told why: only elders may know who
 * is inactive, so a refusal or a reason code built on this stays neutral.
 */
export function isInactive(p: { status?: PublisherStatus | null }): boolean {
  return p.status === PublisherStatus.INACTIVE;
}
