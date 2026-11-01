import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every way of putting a person on something asks `assertAssignable` (or,
 * where the card is already in hand, `isInactive`) — 1 November 2026.
 *
 * The database spec walks the main doors through HTTP; this keeps the rest
 * from losing their check quietly. Lower a number only when a path is gone,
 * and say why; a NEW path that names a person adds its file here.
 */
const GUARDED: Record<string, number> = {
  'assignments/assignments.service.ts': 4, // create, bulk, update, restore
  'duties/duties.service.ts': 2, // assign (and assign-place), custom
  'cart-weeks/cart-weeks.service.ts': 2, // planner's assign, own sign-up
  'field-service-meetings/field-service-meetings.service.ts': 1, // save
  'field-service-meetings/field-service-planner.service.ts': 2, // suggestions
  'field-service-meetings/field-service-attention.service.ts': 1,
  'memorial/memorial.service.ts': 1, // a line's person
  'co-visit-items/co-visit-items.service.ts': 2, // create, update
  'special-events/special-events.service.ts': 3, // accommodation ×3 doors
  'pioneer-meetings/pioneer-meetings.service.ts': 2, // create, update
  'pioneer-school/pioneer-school.service.ts': 3, // helper ×2, duty
  'talk-exchange/talk-exchange.service.ts': 3, // create, update, replace
  'local-needs/local-needs.service.ts': 2, // create, update
  'tasks/tasks.service.ts': 4, // meeting ×2, task ×2
  'tasks/agenda-items.service.ts': 2, // create, update
  'service-groups/service-groups.service.ts': 1, // a new leader
  'responsibilities/responsibilities.service.ts': 1,
};

describe('every door that puts a person somewhere checks for inactive', () => {
  for (const [file, min] of Object.entries(GUARDED)) {
    it(file, () => {
      const src = readFileSync(join(__dirname, '..', file), 'utf8');
      const calls = src.match(/\b(assertAssignable|isInactive)\(/g) ?? [];
      expect(calls.length).toBeGreaterThanOrEqual(min);
    });
  }
});
