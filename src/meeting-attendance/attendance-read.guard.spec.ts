import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AttendanceReadGuard } from './attendance-read.guard';
import { MeetingAttendanceController } from './meeting-attendance.controller';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Who may read the attendance sheet: elders and admins by role; the
 * secretary, the recorder and his stand-in by responsibility; nobody else.
 */
function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function guardHolding(types: ResponsibilityType[]) {
  const repo = {
    count: jest.fn(
      async ({ where }: { where: { type: { value: ResponsibilityType[] } } }) =>
        where.type.value.filter((t) => types.includes(t)).length,
    ),
  };
  return { guard: new AttendanceReadGuard(repo as never), repo };
}

const user = (role: UserRole) => ({
  id: 'u1',
  congregationId: 'cong-1',
  role,
});

describe('reading attendance', () => {
  it.each([UserRole.ADMIN, UserRole.ELDER])(
    'is open to %s by role',
    async (role) => {
      const { guard, repo } = guardHolding([]);
      await expect(guard.canActivate(ctx(user(role)))).resolves.toBe(true);
      expect(repo.count).not.toHaveBeenCalled();
    },
  );

  it.each([
    ResponsibilityType.SECRETARY,
    ResponsibilityType.ATTENDANCE_RECORDER,
    ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
  ])('is open to a publisher who holds %s', async (type) => {
    const { guard } = guardHolding([type]);
    await expect(
      guard.canActivate(ctx(user(UserRole.MINISTERIAL_SERVANT))),
    ).resolves.toBe(true);
  });

  it('is closed to a publisher with no such responsibility', async () => {
    const { guard } = guardHolding([ResponsibilityType.CLEANING_COORDINATOR]);
    await expect(
      guard.canActivate(ctx(user(UserRole.PUBLISHER))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is closed without a user', async () => {
    const { guard } = guardHolding([]);
    await expect(guard.canActivate(ctx(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each(['range', 'serviceYear', 'pending'] as const)(
    'guards the %s route',
    (route) => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        MeetingAttendanceController.prototype[route],
      ) as unknown[];
      expect(guards).toContain(AttendanceReadGuard);
    },
  );
});
