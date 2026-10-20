// Controllers are loaded whole; the push SDK is an ES module jest cannot read.
jest.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken() {
      return true;
    }
  },
}));

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { STAGE_ALLOWED_KEY, StageAllowed } from './stage';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from './enums/user-role.enum';

/**
 * THE SCREEN ON THE STAGE READS ONLY WHAT IT SHOWS (20 October 2026).
 *
 * Two things are pinned: the guard refuses a stage account everything not
 * marked, and the list of what is marked is exactly this one. Adding a door
 * for the stage screen is then a decision made here, in the open — not a
 * decorator slipped onto some controller.
 */
const ALLOWED = [
  'AssignmentsController.list',
  'AuthController.me',
  'AuthController.stageUnlock',
  'AuthController.updateMe',
  'ConductLiveController.find',
  'MeController.myPublisher',
  'MeetingSettingsController.overview',
  'PublishersController.roster',
  'SpecialEventsController.list',
];

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...controllerFiles(p));
    else if (p.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

describe('the stage screen', () => {
  it('may reach exactly the readings its screen is made of', () => {
    const found: string[] = [];
    for (const file of controllerFiles(join(__dirname, '..'))) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file) as Record<string, unknown>;
      for (const value of Object.values(mod)) {
        if (typeof value !== 'function' || !value.name.endsWith('Controller'))
          continue;
        const proto = (value as { prototype: Record<string, unknown> })
          .prototype;
        const classWide =
          Reflect.getMetadata(STAGE_ALLOWED_KEY, value) === true;
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor') continue;
          // A getter is no handler (and would run here).
          const fn = Object.getOwnPropertyDescriptor(proto, name)
            ?.value as unknown;
          if (typeof fn !== 'function') continue;
          if (
            classWide ||
            Reflect.getMetadata(STAGE_ALLOWED_KEY, fn) === true
          ) {
            found.push(`${value.name}.${name}`);
          }
        }
      }
    }
    expect(found.sort()).toEqual([...ALLOWED].sort());
  });

  describe('the guard', () => {
    class Marked {
      @StageAllowed()
      open() {}
      closed() {}
    }
    const guard = new JwtAuthGuard(new Reflector());
    const ctx = (role: string, handler: () => void) =>
      ({
        getHandler: () => handler,
        getClass: () => Marked,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext;

    beforeEach(() => {
      jest
        .spyOn(AuthGuard('jwt').prototype, 'canActivate')
        .mockResolvedValue(true as never);
    });
    afterEach(() => jest.restoreAllMocks());

    it('lets the stage screen through a marked door', async () => {
      await expect(
        guard.canActivate(ctx(UserRole.STAGE, Marked.prototype.open)),
      ).resolves.toBe(true);
    });

    it('refuses the stage screen every other door', async () => {
      await expect(
        guard.canActivate(ctx(UserRole.STAGE, Marked.prototype.closed)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        guard.canActivate(ctx(UserRole.STAGE, Marked.prototype.closed)),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'STAGE_SCREEN_ONLY' }),
      });
    });

    it('changes nothing for people', async () => {
      for (const role of [
        UserRole.ADMIN,
        UserRole.ELDER,
        UserRole.MINISTERIAL_SERVANT,
        UserRole.PUBLISHER,
      ]) {
        await expect(
          guard.canActivate(ctx(role, Marked.prototype.closed)),
        ).resolves.toBe(true);
      }
    });
  });
});
