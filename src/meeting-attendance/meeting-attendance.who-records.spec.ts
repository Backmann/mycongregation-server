import { Reflector } from '@nestjs/core';
import { MeetingAttendanceController } from './meeting-attendance.controller';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { REQUIRE_RESPONSIBILITY_KEY } from '../common/decorators/require-responsibility.decorator';

/**
 * Who may write the attendance figure down.
 *
 * The count is taken AT the meeting and entered while it is still in somebody's
 * hand — so one brother away on a Thursday used to be enough for a week to go
 * unrecorded, unless the secretary happened to notice.
 *
 * The guard reads this list at runtime through the reflector, so the list is
 * what is asserted here: a responsibility added to the screen and forgotten on
 * the route would leave a brother holding a duty the server refuses him.
 */
describe('recording attendance is open to', () => {
  const allowed = new Reflector().get<ResponsibilityType[]>(
    REQUIRE_RESPONSIBILITY_KEY,
    MeetingAttendanceController.prototype.record,
  );

  it('the secretary, the recorder, and the man who stands in for him', () => {
    expect(allowed).toEqual([
      ResponsibilityType.SECRETARY,
      ResponsibilityType.ATTENDANCE_RECORDER,
      ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
    ]);
  });

  it('and to nobody else — the list is closed, not merely long', () => {
    // Named the other way round on purpose: an accidental extra entry here is
    // a privilege granted by inattention.
    expect(allowed).not.toContain(ResponsibilityType.PUBLIC_WITNESSING);
    expect(allowed).not.toContain(ResponsibilityType.CLEANING_COORDINATOR);
  });
});
