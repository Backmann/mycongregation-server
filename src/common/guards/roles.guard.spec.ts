import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../enums/user-role.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createContext(
    user: unknown,
    requiredRoles?: UserRole[],
  ): ExecutionContext {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);

    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  describe('when no roles are required', () => {
    it('allows the request (metadata is undefined)', () => {
      const ctx = createContext({ role: UserRole.PUBLISHER }, undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows the request (metadata is empty array)', () => {
      const ctx = createContext({ role: UserRole.PUBLISHER }, []);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('when roles are required', () => {
    it('allows when user has exactly the required role', () => {
      const ctx = createContext({ role: UserRole.ADMIN }, [UserRole.ADMIN]);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows when user has any of multiple required roles', () => {
      const ctx = createContext(
        { role: UserRole.ELDER },
        [UserRole.ADMIN, UserRole.ELDER],
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows MS when MS is in the required list', () => {
      const ctx = createContext(
        { role: UserRole.MINISTERIAL_SERVANT },
        [UserRole.ADMIN, UserRole.ELDER, UserRole.MINISTERIAL_SERVANT],
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects when user role is not in required list', () => {
      const ctx = createContext(
        { role: UserRole.PUBLISHER },
        [UserRole.ADMIN, UserRole.ELDER],
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects MS when MS is not in required list', () => {
      const ctx = createContext(
        { role: UserRole.MINISTERIAL_SERVANT },
        [UserRole.ADMIN, UserRole.ELDER],
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects when user object exists but lacks role property', () => {
      const ctx = createContext({ role: undefined }, [UserRole.ADMIN]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects when user object is missing entirely', () => {
      const ctx = createContext(undefined, [UserRole.ADMIN]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('forbidden message names the required roles', () => {
      const ctx = createContext(
        { role: UserRole.PUBLISHER },
        [UserRole.ADMIN, UserRole.ELDER],
      );
      expect(() => guard.canActivate(ctx)).toThrow(
        /Requires one of roles.*admin.*elder/,
      );
    });
  });
});
