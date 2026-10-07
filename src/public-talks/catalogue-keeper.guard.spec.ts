import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { CatalogueKeeperGuard } from './catalogue-keeper.guard';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';

const asked = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

/**
 * Setting talks aside: the screen and the server ask ONE question.
 *
 * They asked two — the server for the role of elder, the screen for the duty
 * of coordinator — and so an assistant who is a ministerial servant was shown
 * the button and refused on pressing it.
 */
describe('CatalogueKeeperGuard', () => {
  let count: jest.Mock;
  let guard: CatalogueKeeperGuard;

  beforeEach(() => {
    count = jest.fn(async () => 0);
    guard = new CatalogueKeeperGuard({
      count,
    } as unknown as Repository<Responsibility>);
  });

  it.each([UserRole.ADMIN, UserRole.ELDER])(
    'a %s may, by the role alone — nothing is looked up',
    async (role) => {
      await expect(
        guard.canActivate(asked({ id: 'u1', role, congregationId: 'c1' })),
      ).resolves.toBe(true);
      expect(count).not.toHaveBeenCalled();
    },
  );

  it('the coordinator or his assistant may, whatever their role — the case that was refused', async () => {
    count.mockResolvedValue(1);

    await expect(
      guard.canActivate(
        asked({
          id: 'u1',
          role: UserRole.MINISTERIAL_SERVANT,
          congregationId: 'c1',
        }),
      ),
    ).resolves.toBe(true);

    const where = (
      count.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({ congregationId: 'c1', userId: 'u1' });
    // Both duties, and only in the caller's own congregation.
    expect(JSON.stringify(where.type)).toContain(
      ResponsibilityType.PUBLIC_TALK_COORDINATOR,
    );
    expect(JSON.stringify(where.type)).toContain(
      ResponsibilityType.PUBLIC_TALK_COORDINATOR_ASSISTANT,
    );
  });

  it.each([UserRole.MINISTERIAL_SERVANT, UserRole.PUBLISHER])(
    'a %s with neither duty may not',
    async (role) => {
      await expect(
        guard.canActivate(asked({ id: 'u1', role, congregationId: 'c1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('nobody signed in may not', async () => {
    await expect(guard.canActivate(asked(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('stands on all three doors of setting talks aside, and the role-only guard on none of them', () => {
    const source = readFileSync(
      join(__dirname, 'public-talks.controller.ts'),
      'utf8',
    );
    for (const door of [
      'retirement-preview',
      'lift-restriction',
      'retire-missing',
    ]) {
      const at = source.indexOf(`@Post('${door}')`);
      expect(at).toBeGreaterThan(-1);
      const head = source.slice(at, at + 120);
      expect(head).toContain('@UseGuards(CatalogueKeeperGuard)');
      expect(head).not.toContain('@Roles(');
    }
  });
});
