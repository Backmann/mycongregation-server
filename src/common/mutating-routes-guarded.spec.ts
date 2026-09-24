import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every route that changes something says who may call it (24 September).
 *
 * RolesGuard lets a route without @Roles through to anyone signed in — that
 * is how «revoke an invitation» ended up open to every member while its own
 * comment said «admin only». This test reads each controller and fails on a
 * POST, PATCH, PUT or DELETE that carries no @Roles, @RequireResponsibility
 * or @UseGuards of its own — unless its controller is listed below, where
 * the service itself checks the caller (and the reason is written down).
 */
const CHECKED_IN_SERVICE: Record<string, string> = {
  absences: 'service: a person for himself, planners for others',
  auth: 'sign-in, reset and one\u2019s own account — public or self by design',
  'auxiliary-pioneers': 'service: self-application, managers for others',
  'cart-slots':
    'the self-service routes (request, my-assignment); the rest carry @RequireResponsibility',
  cleaning: 'the group plans its own day; the service checks the group',
  'external-congregations': 'service: talk coordinators',
  journal: 'service: assertMayAsk (admin)',
  'local-needs': 'service: life-and-ministry overseer',
  me: 'the caller\u2019s own data',
  'pioneer-school': 'service: admin',
  'push-tokens': 'the caller\u2019s own device',
  'service-reports': 'service: own report, group overseer, secretary',
  'talk-exchange': 'service: talk coordinators',
  tasks: 'service: elders, addressees',
  'visiting-speakers': 'service: talk coordinators',
  'web-push-subscriptions': 'the caller\u2019s own browser',
};

function controllers(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...controllers(p));
    else if (name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

describe('every route that changes something says who may call it', () => {
  const root = join(__dirname, '..');
  const bare: string[] = [];
  for (const file of controllers(root)) {
    const src = readFileSync(file, 'utf8');
    const base = /@Controller\('([^']*)'\)/.exec(src)?.[1] ?? file;
    if (base in CHECKED_IN_SERVICE) continue;
    const head = src.slice(0, src.indexOf('export class'));
    const classGuarded = /@(Roles|RequireResponsibility)\(/.test(head);
    const body = src.slice(src.indexOf('export class'));
    // A handler: a run of decorators, then its name and «(».
    const re =
      /((?:\s*@[A-Za-z]+\((?:[^()]|\([^()]*\))*\)\s*)+)\s*(?:async\s+)?([a-zA-Z]+)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const decos = m[1];
      const verb = /@(Post|Patch|Put|Delete)\(/.exec(decos);
      if (!verb) continue;
      const own = /@(Roles|RequireResponsibility|UseGuards)\(/.test(decos);
      if (!own && !classGuarded) bare.push(`${base} ${verb[1]} ${m[2]}`);
    }
  }

  it('finds no route that changes something with nobody named to call it', () => {
    expect(bare).toEqual([]);
  });
});
