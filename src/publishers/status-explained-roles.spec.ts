// The controller's import chain reaches the Expo SDK (ESM): mock it first.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { PublishersController } from './publishers.controller';

/**
 * The reasoning behind a status carries the status itself and the silent
 * months behind it, so it is read by those who may see the status: admins
 * and elders (28 October 2026). It used to be open to anyone the card is
 * open to — a brother with access to private data, from whose card the
 * status is stripped, read it here.
 */
describe('GET /publishers/:id/status-explained', () => {
  it('is for admins and elders only', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PublishersController.prototype.explainStatus,
    ) as UserRole[];
    expect([...roles].sort()).toEqual([UserRole.ADMIN, UserRole.ELDER].sort());
  });

  it('the card itself stays open to private-data access (unchanged)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, PublishersController.prototype.findOne),
    ).toBeUndefined();
  });
});
