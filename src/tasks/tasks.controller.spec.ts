jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { ForbiddenException } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { UserRole } from '../common/enums/user-role.enum';

const elder = {
  id: 'u-elder',
  role: UserRole.ELDER,
  congregationId: 'c1',
} as never;

/**
 * Naming an elders' meeting.
 *
 * Untested is how it came to be unchecked: every other write on a meeting
 * asked mustBuild and this one did not, and nothing said so. The second test
 * matters as much as the first — adoptWaiting must still run for the person
 * who may build, or fixing the rights would quietly strand every carried-over
 * question instead.
 */
describe('TasksController — naming an elders meeting', () => {
  const build = (mayBuild: boolean) => {
    const service = {
      createMeeting: jest.fn(async () => ({ id: 'm1' })),
    };
    const items = {
      mayBuild: jest.fn(async () => mayBuild),
      adoptWaiting: jest.fn(async () => 0),
    };
    const controller = new TasksController(
      service as never,
      {} as never,
      items as never,
    );
    return { controller, service, items };
  };

  it('refuses an elder who does not build the agenda', async () => {
    const { controller, service, items } = build(false);

    await expect(
      controller.createMeeting('c1', { date: '2026-09-01' } as never, elder),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.createMeeting).not.toHaveBeenCalled();
    // And nothing was swept up on the way out.
    expect(items.adoptWaiting).not.toHaveBeenCalled();
  });

  it('lets the coordinator name one, and takes up what was waiting', async () => {
    const { controller, service, items } = build(true);

    await controller.createMeeting(
      'c1',
      { date: '2026-09-01' } as never,
      elder,
    );

    expect(service.createMeeting).toHaveBeenCalled();
    expect(items.adoptWaiting).toHaveBeenCalledWith('c1', 'm1');
  });
});
