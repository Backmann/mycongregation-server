import { deriveRoleFromAppointment } from './publishers.service';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UserRole } from '../common/enums/user-role.enum';

describe('deriveRoleFromAppointment', () => {
  it('maps an elder to the elder role', () => {
    expect(deriveRoleFromAppointment(PublisherAppointment.ELDER)).toBe(
      UserRole.ELDER,
    );
  });

  it('maps a ministerial servant to its role', () => {
    expect(
      deriveRoleFromAppointment(PublisherAppointment.MINISTERIAL_SERVANT),
    ).toBe(UserRole.MINISTERIAL_SERVANT);
  });

  it('maps a publisher to the publisher role', () => {
    expect(deriveRoleFromAppointment(PublisherAppointment.PUBLISHER)).toBe(
      UserRole.PUBLISHER,
    );
  });

  it('maps an unbaptized publisher to the publisher role', () => {
    expect(
      deriveRoleFromAppointment(PublisherAppointment.UNBAPTIZED_PUBLISHER),
    ).toBe(UserRole.PUBLISHER);
  });

  it('maps "none" to the publisher role (lowest tier)', () => {
    expect(deriveRoleFromAppointment(PublisherAppointment.NONE)).toBe(
      UserRole.PUBLISHER,
    );
  });
});
