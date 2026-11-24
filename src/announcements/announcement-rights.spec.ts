import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import {
  ANNOUNCEMENT_WRITERS,
  chairmanPart,
  isWriter,
  keptFromWeek,
} from './announcement-rights';

describe('who writes the announcements (R-02)', () => {
  it('the coordinator of the body of elders, his assistant and the admins — nobody else', () => {
    expect(isWriter(UserRole.ADMIN, [])).toBe(true);
    expect(
      isWriter(UserRole.ELDER, [ResponsibilityType.BODY_COORDINATOR]),
    ).toBe(true);
    expect(
      isWriter(UserRole.ELDER, [ResponsibilityType.BODY_COORDINATOR_ASSISTANT]),
    ).toBe(true);
    // An elder with another office, the secretary, a publisher: no.
    expect(isWriter(UserRole.ELDER, [])).toBe(false);
    expect(isWriter(UserRole.ELDER, [ResponsibilityType.SECRETARY])).toBe(
      false,
    );
    expect(
      isWriter(UserRole.ELDER, [ResponsibilityType.LIFE_MINISTRY_OVERSEER]),
    ).toBe(false);
    expect(isWriter(UserRole.PUBLISHER, [])).toBe(false);
    expect(ANNOUNCEMENT_WRITERS).toHaveLength(2);
  });

  it('the chairman is the one who holds the chairman’s part of that meeting', () => {
    expect(chairmanPart('midweek')).toBe('midweek_chairman');
    expect(chairmanPart('weekend')).toBe('weekend_chairman');
  });
});

describe('kept 30 days after the week (R-03)', () => {
  it('keeps a week whose Sunday is 30 days ago, drops the week before it', () => {
    // Today Tuesday 2026-12-29: 30 days back is Sunday 2026-11-29, the end of
    // the week of Monday 2026-11-23 — kept. The week of 2026-11-16 is not.
    const from = keptFromWeek('2026-12-29');
    expect('2026-11-23' >= from).toBe(true);
    expect('2026-11-16' >= from).toBe(false);
  });

  it('on the 31st day after the Sunday the week goes', () => {
    // Wednesday 2026-12-30 is 31 days after Sunday 2026-11-29.
    expect('2026-11-23' >= keptFromWeek('2026-12-30')).toBe(false);
  });
});
