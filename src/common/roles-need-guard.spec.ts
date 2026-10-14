import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @Roles on its own does nothing (14 October 2026).
 *
 * RolesGuard is not global: a controller switches it on with
 * @UseGuards(RolesGuard). A route marked @Roles(...) in a controller that
 * never does is open to everyone signed in — and the route-guard test
 * (mutating-routes-guarded.spec.ts) counts the @Roles as an answer. The new
 * conduct-runs controller went out like that on the stand: a publisher's PUT
 * reached the service. This fails on any controller that names roles
 * without the guard that reads them.
 */
function controllers(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...controllers(p));
    else if (name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

describe('a controller that names roles switches on the guard that reads them', () => {
  const root = join(__dirname, '..');
  const bare = controllers(root)
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /@Roles\(/.test(src) && !/@UseGuards\([^)]*RolesGuard/.test(src);
    })
    .map((f) => f.slice(root.length + 1));

  it('finds none with @Roles and no RolesGuard', () => {
    expect(bare).toEqual([]);
  });
});
