import { In, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { UserRole } from './enums/user-role.enum';
import { ResponsibilityType } from './enums/responsibility-type.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * WHO OVERSEES HOW THE MIDWEEK MEETING RUNS (Lionel, 16 October 2026): the
 * admins, the brother who gives counsel (ADVISER) and the overseer of the
 * Life and Ministry meeting. They — and only they, besides the hands that
 * run the meeting — see it as it runs (conduct-live) and read how it ran
 * (conduct-runs). Not every appointed brother, as on 15 October; not the
 * chairman of the week afterwards either: he sees the result on his own
 * screen when the meeting ends, and that is all.
 *
 * One rule for both views, so the two cannot drift.
 */
export const CONDUCT_OVERSEER_RESPONSIBILITIES: ResponsibilityType[] = [
  ResponsibilityType.ADVISER,
  ResponsibilityType.LIFE_MINISTRY_OVERSEER,
];

export async function isConductOverseer(
  user: AuthenticatedUser,
  publishers: Repository<Publisher>,
): Promise<boolean> {
  if (user.role === UserRole.ADMIN) return true;
  const held = await publishers.manager.count(Responsibility, {
    where: {
      congregationId: user.congregationId,
      userId: user.id,
      type: In(CONDUCT_OVERSEER_RESPONSIBILITIES),
    },
  });
  return held > 0;
}
