import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * Map a publisher's spiritual appointment to the login role granted with it.
 * Admin is never derived — it is an explicit, separate elevation.
 *
 * Kept in its own dependency-free module so it can be unit-tested without
 * pulling in the full PublishersService (and its push-notifications chain).
 */
export function deriveRoleFromAppointment(
  appointment: PublisherAppointment,
): UserRole {
  switch (appointment) {
    case PublisherAppointment.ELDER:
      return UserRole.ELDER;
    case PublisherAppointment.MINISTERIAL_SERVANT:
      return UserRole.MINISTERIAL_SERVANT;
    default:
      return UserRole.PUBLISHER;
  }
}
