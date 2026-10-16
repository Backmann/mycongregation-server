import { In, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { UserRole } from './enums/user-role.enum';
import { PublisherAppointment } from './enums/publisher-appointment.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * An appointed brother — an elder or a ministerial servant — by the role of
 * his account OR by his own card. The two can differ: a ministerial servant
 * whose account was opened as a publisher is still a ministerial servant
 * (Lionel, 15 October 2026: «по назначению в карточке»). An admin counts too.
 *
 * One rule for both views of a midweek meeting — the meeting as it runs
 * (conduct-live) and how it ran (conduct-runs) — so the two cannot drift.
 */
export async function isAppointedBrother(
  user: AuthenticatedUser,
  publishers: Repository<Publisher>,
): Promise<boolean> {
  if (
    user.role === UserRole.ADMIN ||
    user.role === UserRole.ELDER ||
    user.role === UserRole.MINISTERIAL_SERVANT
  ) {
    return true;
  }
  const mine = await publishers.findOne({
    where: {
      congregationId: user.congregationId,
      userId: user.id,
      appointment: In([
        PublisherAppointment.ELDER,
        PublisherAppointment.MINISTERIAL_SERVANT,
      ]),
    },
  });
  return !!mine;
}
