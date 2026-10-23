import { readdirSync } from 'fs';
import { join } from 'path';

/**
 * TypeORM loads EVERY exported function of a file in migrations/ as a
 * migration class (23 October 2026: a helper exported next to a migration
 * stopped `migration:run` with «getFromContainer» — and the server runs its
 * migrations on boot). Helpers live elsewhere; this holds the folder to it.
 */
describe('migrations folder', () => {
  const dir = join(__dirname, '..');
  const files = readdirSync(dir).filter((f) => /^\d+-.+\.ts$/.test(f));

  it.each(files)('%s exports only migration classes', (file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(join(dir, file)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== 'function') continue;
      const proto = (value as { prototype?: { up?: unknown } }).prototype;
      expect({ name, isMigration: typeof proto?.up === 'function' }).toEqual({
        name,
        isMigration: true,
      });
    }
  });
});
