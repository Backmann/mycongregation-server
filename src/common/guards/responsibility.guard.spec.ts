import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { ResponsibilityGuard } from './responsibility.guard';
import { Responsibility } from '../../entities/responsibility.entity';
import { ResponsibilityType } from '../enums/responsibility-type.enum';
import { UserRole } from '../enums/user-role.enum';

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('ResponsibilityGuard', () => {
  let guard: ResponsibilityGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let repo: { count: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    repo = { count: jest.fn() };
    guard = new ResponsibilityGuard(
      reflector as unknown as Reflector,
      repo as unknown as Repository<Responsibility>,
    );
  });

  it('allows when no responsibility is required', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(makeContext({ id: 'u1', role: UserRole.PUBLISHER })),
    ).resolves.toBe(true);
    expect(repo.count).not.toHaveBeenCalled();
  });

  it('allows admins without checking responsibilities', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ]);

    await expect(
      guard.canActivate(
        makeContext({
          id: 'admin1',
          role: UserRole.ADMIN,
          congregationId: 't1',
        }),
      ),
    ).resolves.toBe(true);
    expect(repo.count).not.toHaveBeenCalled();
  });

  it('allows a non-admin who holds the required responsibility', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ]);
    repo.count.mockResolvedValue(1);

    await expect(
      guard.canActivate(
        makeContext({ id: 'u1', role: UserRole.ELDER, congregationId: 't1' }),
      ),
    ).resolves.toBe(true);
    expect(repo.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ congregationId: 't1', userId: 'u1' }),
    });
  });

  it('rejects a non-admin who does not hold the responsibility', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ]);
    repo.count.mockResolvedValue(0);

    await expect(
      guard.canActivate(
        makeContext({ id: 'u1', role: UserRole.ELDER, congregationId: 't1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when there is no user context', async () => {
    reflector.getAllAndOverride.mockReturnValue([ResponsibilityType.SECRETARY]);

    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
