import { In, type FindOptionsWhere } from 'typeorm';
import type { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Who sees the programme before it is sent out (drafts): the administrator,
 * the Life and Ministry overseer and the coordinator of the body of elders.
 * ONE answer for the programme itself and for the people pickers' history
 * (20 November 2026: the history began to reach weeks ahead, where most of
 * the planned parts are still drafts).
 */
export async function canSeeProgrammeDrafts(
  responsibilities: {
    count(o: { where: FindOptionsWhere<Responsibility> }): Promise<number>;
  },
  user?: AuthenticatedUser,
): Promise<boolean> {
  if (!user) return true;
  if (user.role === UserRole.ADMIN) return true;
  const held = await responsibilities.count({
    where: {
      congregationId: user.congregationId,
      userId: user.id,
      type: In([
        'life_ministry_overseer',
        'body_coordinator',
        // Stands in for the coordinator (21 November 2026).
        'body_coordinator_assistant',
      ] as ResponsibilityType[]),
    },
  });
  return held > 0;
}
