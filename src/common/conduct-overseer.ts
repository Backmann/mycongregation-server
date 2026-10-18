import { In, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { UserRole } from './enums/user-role.enum';
import { ResponsibilityType } from './enums/responsibility-type.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { EventType } from './enums/event-type.enum';
import type { ConductKind } from './conduct-kind';

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

/**
 * THE WEEKEND MEETING (Lionel, 18 October 2026): the coordinator of the body
 * of elders and his assistant, the Watchtower study conductor and his
 * assistants, the counsel brother — and the admins, as always.
 */
export const WEEKEND_CONDUCT_OVERSEER_RESPONSIBILITIES: ResponsibilityType[] = [
  ResponsibilityType.BODY_COORDINATOR,
  ResponsibilityType.BODY_COORDINATOR_ASSISTANT,
  ResponsibilityType.WT_STUDY_CONDUCTOR,
  ResponsibilityType.WT_STUDY_CONDUCTOR_BACKUP,
  ResponsibilityType.ADVISER,
];

export function conductOverseerResponsibilities(
  kind: ConductKind,
): ResponsibilityType[] {
  return kind === EventType.WEEKEND
    ? WEEKEND_CONDUCT_OVERSEER_RESPONSIBILITIES
    : CONDUCT_OVERSEER_RESPONSIBILITIES;
}

export async function isConductOverseer(
  user: AuthenticatedUser,
  publishers: Repository<Publisher>,
  kind: ConductKind = EventType.MIDWEEK,
): Promise<boolean> {
  if (user.role === UserRole.ADMIN) return true;
  const held = await publishers.manager.count(Responsibility, {
    where: {
      congregationId: user.congregationId,
      userId: user.id,
      type: In(conductOverseerResponsibilities(kind)),
    },
  });
  return held > 0;
}
