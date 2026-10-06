import { ForbiddenException } from '@nestjs/common';
import { AuxiliaryPioneersController } from './auxiliary-pioneers.controller';
import type { AuxiliaryPioneersService } from './auxiliary-pioneers.service';
import type { CongregationClock } from '../common/congregation-clock.service';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * Who is given what. The working list — a month with its hour goal, the
 * journal, the pioneers without a date — is for those who keep it; everybody
 * else is given this month's names and nothing more.
 */
describe('AuxiliaryPioneersController — who reads what', () => {
  const CONG = 'cong-1';
  const publisher = { id: 'u-1', role: UserRole.PUBLISHER } as never;
  const elder = { id: 'u-2', role: UserRole.ELDER } as never;

  function make(manager: boolean) {
    const service = {
      assertCanManage: jest.fn(async () => {
        if (!manager) throw new ForbiddenException();
      }),
      listForMonth: jest.fn(async () => ({
        month: 'm',
        hourGoal: 30,
        rows: [],
      })),
      journal: jest.fn(async () => []),
      pioneersMissingDate: jest.fn(async () => []),
      servingNow: jest.fn(async () => ({ month: '2026-10-01', people: [] })),
    };
    const clock = { todayFor: jest.fn(async () => '2026-10-06') };
    const controller = new AuxiliaryPioneersController(
      service as unknown as AuxiliaryPioneersService,
      clock as unknown as CongregationClock,
    );
    return { controller, service };
  }

  it.each([
    ['a publisher', publisher],
    ['an elder with no such responsibility', elder],
  ])(
    '%s is refused the month, the journal and the missing dates — and nothing is read',
    async (_n, user) => {
      const { controller, service } = make(false);
      await expect(
        controller.list(CONG, user, '2026-10-01'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.journal(CONG, user)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        controller.pioneersMissingDate(CONG, user),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.listForMonth).not.toHaveBeenCalled();
      expect(service.journal).not.toHaveBeenCalled();
      expect(service.pioneersMissingDate).not.toHaveBeenCalled();
    },
  );

  it('whoever keeps the list reads all three', async () => {
    const { controller, service } = make(true);
    await controller.list(CONG, elder, '2026-10-01');
    await controller.journal(CONG, elder);
    await controller.pioneersMissingDate(CONG, elder);
    expect(service.assertCanManage).toHaveBeenCalledTimes(3);
    expect(service.listForMonth).toHaveBeenCalledWith(CONG, '2026-10-01');
    expect(service.journal).toHaveBeenCalledWith(CONG);
    expect(service.pioneersMissingDate).toHaveBeenCalledWith(CONG);
  });

  it('this month’s names are given to everybody, and take no month from the asker', async () => {
    const { controller, service } = make(false);
    await expect(controller.servingNow(CONG)).resolves.toEqual({
      month: '2026-10-01',
      people: [],
    });
    expect(service.assertCanManage).not.toHaveBeenCalled();
    expect(service.servingNow).toHaveBeenCalledWith(CONG);
    expect(controller.servingNow.length).toBe(1);
  });
});
