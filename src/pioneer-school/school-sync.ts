/**
 * The pioneer school's absences brought in line after the calendar changed
 * (24 October 2026) — a circuit overseer's visit, an assembly, the Memorial.
 * A token and a bare interface, so the calendar's side does not import the
 * school's service (and its whole graph) to call one method.
 */
export const SCHOOL_SYNC = Symbol('SCHOOL_SYNC');

export interface SchoolSync {
  resyncUpcoming(tenantId?: string): Promise<number>;
}
