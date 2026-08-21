import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PioneerSchoolService } from './pioneer-school.service';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * Taking back the removal of a school helper.
 *
 * Removing one was already gentle — the row is hidden, not destroyed, so his
 * name stays on the schools he served. What was missing was the way to say
 * «not that one» in the second after the tap: the only route back was the
 * database itself, which is no route at all for the person holding the phone.
 */
describe('PioneerSchoolService.restoreHelper', () => {
  const build = (helper: unknown) => {
    const restore = jest.fn().mockResolvedValue({ affected: 1 });
    const findOne = jest.fn().mockResolvedValue(helper);
    const service = Object.create(
      PioneerSchoolService.prototype,
    ) as PioneerSchoolService;
    Object.assign(service, { helpersRepo: { findOne, restore } });
    return { service, restore, findOne };
  };

  const admin = { id: 'u1', role: UserRole.ADMIN } as never;
  const elder = { id: 'u2', role: UserRole.ELDER } as never;

  it('brings back a removed helper', async () => {
    const { service, restore } = build({
      id: 'h1',
      deletedAt: new Date('2026-08-21T10:00:00Z'),
    });

    await service.restoreHelper('c1', 'h1', admin);

    expect(restore).toHaveBeenCalledWith('h1');
  });

  it('looks for him among the removed — otherwise he is not there to restore', async () => {
    // findOne without withDeleted would answer «not found» for exactly the row
    // this method exists to bring back.
    const { service, findOne } = build({ id: 'h1', deletedAt: new Date() });

    await service.restoreHelper('c1', 'h1', admin);

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
  });

  it('does nothing to a helper who was never removed', async () => {
    // Pressing «Отменить» twice must not turn into an error.
    const { service, restore } = build({ id: 'h1', deletedAt: null });

    await expect(
      service.restoreHelper('c1', 'h1', admin),
    ).resolves.toBeUndefined();
    expect(restore).not.toHaveBeenCalled();
  });

  it('refuses an id that belongs to nobody here', async () => {
    const { service } = build(null);

    await expect(
      service.restoreHelper('c1', 'h1', admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is for the same people who may remove one', async () => {
    // An elder cannot remove a helper, so he must not be able to un-remove one
    // either — otherwise the pair of buttons obeys two different rules.
    const { service, restore } = build({ id: 'h1', deletedAt: new Date() });

    await expect(
      service.restoreHelper('c1', 'h1', elder),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(restore).not.toHaveBeenCalled();
  });
});
