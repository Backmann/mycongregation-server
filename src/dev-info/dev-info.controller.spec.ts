import { NotFoundException } from '@nestjs/common';
import { DevInfoController } from './dev-info.controller';

const config = (nodeEnv: string) => ({ get: () => nodeEnv }) as never;
const dataSource = (pending: boolean) =>
  ({ showMigrations: async () => pending }) as never;

describe('DevInfoController — /api/health/dev', () => {
  it('does not exist outside development', async () => {
    const c = new DevInfoController(config('production'), dataSource(false));
    await expect(c.devInfo()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('in development tells the source it started from and pending migrations', async () => {
    const c = new DevInfoController(config('development'), dataSource(true));
    const info = await c.devInfo();
    // Jest runs in the server folder, so there is a src/ to fingerprint.
    expect(info.sourceFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(info.pendingMigrations).toBe(true);
  });
});
