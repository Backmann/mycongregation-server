import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Who may READ the attendance figures (form S-3).
 *
 * The elders look after the congregation and read the sheet; the secretary
 * keeps it; the brother who counts at the meeting and the one who stands in
 * for him enter the numbers and need to see what is already there. A
 * publisher has no task that needs the sheet, so it is not his to open.
 *
 * Unlike ResponsibilityGuard this is «role OR responsibility»: an elder reads
 * without holding a responsibility, a ministerial servant reads only when he
 * counts.
 */
export const ATTENDANCE_READ_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.ELDER,
];
export const ATTENDANCE_READ_RESPONSIBILITIES: readonly ResponsibilityType[] = [
  ResponsibilityType.SECRETARY,
  ResponsibilityType.ATTENDANCE_RECORDER,
  ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
];

@Injectable()
export class AttendanceReadGuard implements CanActivate {
  constructor(
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException('No user context');
    if (ATTENDANCE_READ_ROLES.includes(user.role)) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([...ATTENDANCE_READ_RESPONSIBILITIES]),
      },
    });
    if (held > 0) return true;
    throw new ForbiddenException(
      'Attendance is for elders and those who record it.',
    );
  }
}
