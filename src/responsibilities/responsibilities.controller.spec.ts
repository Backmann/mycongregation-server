import { ResponsibilitiesController } from './responsibilities.controller';
import type { ResponsibilitiesService } from './responsibilities.service';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Who carries which duty is told to everybody. Who appointed him, and when,
 * is the administrator's record and is told to the administrator alone.
 */
describe('ResponsibilitiesController.findAll — who is told what', () => {
  const full = [
    {
      id: 'r-1',
      congregationId: 'cong-1',
      type: ResponsibilityType.SECRETARY,
      userId: 'u-sec',
      assignedBy: 'u-admin',
      assignedAt: new Date('2026-06-09T09:26:00Z'),
      holderName: 'Бергман Вернер',
      assignedByName: 'Кёниг Даниэль',
    },
    {
      id: 'r-2',
      congregationId: 'cong-1',
      type: ResponsibilityType.ACCOUNTS_SERVANT,
      userId: 'u-acc',
      assignedBy: null,
      assignedAt: new Date('2026-06-10T09:00:00Z'),
      holderName: 'Фукс Отто',
      assignedByName: null,
    },
  ];
  const controller = new ResponsibilitiesController({
    findAll: jest.fn(async () => full),
  } as unknown as ResponsibilitiesService);
  const as = (role: UserRole) => ({ id: 'u-x', role }) as never;

  it.each([UserRole.PUBLISHER, UserRole.MINISTERIAL_SERVANT, UserRole.ELDER])(
    '%s: the duty, the holder, his name — and nothing else',
    async (role) => {
      const res = await controller.findAll('cong-1', as(role));
      expect(res).toEqual([
        { type: 'secretary', userId: 'u-sec', holderName: 'Бергман Вернер' },
        { type: 'accounts_servant', userId: 'u-acc', holderName: 'Фукс Отто' },
      ]);
      expect(JSON.stringify(res)).not.toMatch(
        /assigned|Кёниг|u-admin|r-1|cong-1|2026/,
      );
    },
  );

  it('every duty is told, the accounts servant among them', async () => {
    const res = await controller.findAll('cong-1', as(UserRole.PUBLISHER));
    expect(res).toHaveLength(full.length);
  });

  it('the administrator reads the record whole', async () => {
    const res = await controller.findAll('cong-1', as(UserRole.ADMIN));
    expect(res).toBe(full);
  });
});
