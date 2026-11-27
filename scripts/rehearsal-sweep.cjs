/* eslint-disable */
// A sweep of the release under rehearsal (27 November 2026, step 4 of the
// TypeORM 1.x plan). Runs INSIDE the rehearsal image, next to the rehearsal
// app, on the throwaway copy of the live database — never on production.
//
//   1. Every GET route without a path parameter, once per role of every
//      congregation (one active user of each role), against the rehearsal
//      app. Tokens are signed here with the app's own JwtService; they are
//      only ever sent to the rehearsal app on the isolated network.
//   2. Every @Cron method, called once in this process's own copy of the
//      app (its scheduler stopped first, so nothing fires twice).
//
// Prints counts, route patterns, role names, job names, error class names and
// the property a where-condition rejected. Never a row, a message, a name, an
// id or a token: the copy holds real people.
//
//   node rehearsal-sweep.cjs        (SWEEP_TARGET, APP_ROOT to override)
'use strict';
const http = require('http');

const APP_ROOT = process.env.APP_ROOT || '/app';
const TARGET = process.env.SWEEP_TARGET || 'http://mcg-rehearsal-app:3000';
const PREFIX = '/' + (process.env.API_PREFIX || 'api');
const JOB_TIMEOUT_MS = 120_000;
const req = (m) => require(require.resolve(m, { paths: [APP_ROOT] }));
/** TypeORM's refusals of an empty where value: only the property is kept. */
const WHERE_EMPTY =
  /(Null|Undefined) value encountered in (?:property|nested relation) '([^']+)'/;

/** What may be printed about an error: its class and a where's property. */
function describe(e) {
  const kind = (e && e.constructor && e.constructor.name) || typeof e;
  const m = WHERE_EMPTY.exec(String((e && e.message) || ''));
  return m ? `${kind}: ${m[1].toLowerCase()} in where '${m[2]}'` : kind;
}

function get(path, token) {
  return new Promise((resolve) => {
    const r = http.get(
      TARGET + path,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 60_000 },
      (res) => {
        let body = '';
        res.on('data', (d) => {
          if (body.length < 4000) body += d;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
        res.on('error', () => resolve({ status: 0, body: '' }));
        res.on('aborted', () => resolve({ status: 0, body: '' }));
      },
    );
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', () => resolve({ status: 0, body: '' }));
  });
}

/**
 * A route refused for a missing query value (400) is asked once more with the
 * values its own refusal names: this week, today, this month, this year — so
 * the request reaches the database. The refusal itself is never printed.
 */
const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const monday = new Date(now);
monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
const plus = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};
const month = iso(now).slice(0, 7);
const DATES = {
  weekStart: iso(monday),
  weekStartDate: iso(monday),
  weekEnd: iso(plus(monday, 28)),
  date: iso(now),
  from: iso(monday),
  to: iso(plus(monday, 27)),
  month,
  reportMonth: month,
  startYear: String(
    now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1,
  ),
  year: String(now.getUTCFullYear()),
};
const MONTHS = { ...DATES, from: month, to: month };
function queryFor(body) {
  // The names come from the refusal's own fields (a message like «… must be
  // a valid ISO 8601 date string» would also match «date»; an extra field is
  // refused). A refusal without fields names its field in the message.
  let fields = [];
  try {
    fields = (JSON.parse(body).fields || []).map((f) => f.field);
  } catch {}
  const named = new Set(fields.filter((f) => f in DATES));
  for (const k of ['weekStart', 'weekStartDate', 'reportMonth', 'startYear'])
    if (new RegExp(`\\b${k}\\b`).test(body)) named.add(k);
  if (/\bfrom and to\b/.test(body)) named.add('from').add('to');
  if (named.has('month') && named.has('from')) named.delete('month');
  if (!named.size) return [];
  const q = (vals) => '?' + [...named].map((k) => `${k}=${vals[k]}`).join('&');
  return /\bmonths?\b/i.test(body)
    ? [q(MONTHS), q(DATES)]
    : [q(DATES), q(MONTHS)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An error nobody awaited would otherwise be printed whole by Node — a
// QueryFailedError carries its parameters. Only its class goes out.
for (const ev of ['unhandledRejection', 'uncaughtException'])
  process.on(ev, (e) => {
    console.log(`SWEEP STOPPED: unhandled ${describe(e)}`);
    process.exit(3);
  });

async function main() {
  const { NestFactory, ModulesContainer } = req('@nestjs/core');
  const { PATH_METADATA, METHOD_METADATA } = req('@nestjs/common/constants');
  const { RequestMethod } = req('@nestjs/common');
  const { SchedulerRegistry } = req('@nestjs/schedule');
  const { SCHEDULE_CRON_OPTIONS } = req(
    '@nestjs/schedule/dist/schedule.constants',
  );
  const { JwtService } = req('@nestjs/jwt');
  const { DataSource } = req('typeorm');
  const { AppModule } = require(APP_ROOT + '/dist/src/app.module');

  // Jobs often catch their own errors and only log them: the log is where
  // they show. Messages may name people, so only the logger's context and a
  // where's property are kept — and counted against the job that ran.
  const logged = [];
  const quiet = () => {};
  const keep =
    (level) =>
    (msg, ...rest) => {
      const text = [msg, ...rest]
        .map((x) => (x && x.stack) || String(x))
        .join(' ');
      const m = WHERE_EMPTY.exec(text);
      if (!m && level === 'warn') return; // a warning counts only for a where
      const ctx =
        typeof rest[rest.length - 1] === 'string' &&
        !/\n/.test(rest[rest.length - 1])
          ? rest[rest.length - 1]
          : '?';
      logged.push(m ? `${ctx}: ${m[1].toLowerCase()} in where '${m[2]}'` : ctx);
    };
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: {
      log: quiet,
      warn: keep('warn'),
      debug: quiet,
      verbose: quiet,
      fatal: keep('error'),
      error: keep('error'),
    },
    // A failed start must come back here as an error, not exit silently.
    abortOnError: false,
  });
  const bootErrors = logged.splice(0);
  if (bootErrors.length)
    console.log(`  errors logged while starting: ${bootErrors.join('; ')}`);
  const registry = app.get(SchedulerRegistry);
  const registered = registry.getCronJobs().size;
  for (const job of registry.getCronJobs().values()) job.stop();
  console.log(
    `  where rule in this process: ${process.env.WHERE_INVALID_VALUES === 'throw' ? 'throw' : 'off (0.3)'}`,
  );

  // ---- what exists: routes and jobs, read from the code itself ----
  const routes = new Set();
  let withParam = 0;
  const jobs = [];
  const join = (...p) =>
    ('/' + p.filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/\/$/, '');
  for (const mod of app.get(ModulesContainer).values()) {
    for (const w of mod.controllers.values()) {
      const t = w.metatype;
      if (!t) continue;
      const bases = [].concat(Reflect.getMetadata(PATH_METADATA, t) || '');
      for (const name of Object.getOwnPropertyNames(t.prototype)) {
        const fn = (Object.getOwnPropertyDescriptor(t.prototype, name) || {})
          .value;
        if (typeof fn !== 'function' || name === 'constructor') continue;
        if (Reflect.getMetadata(METHOD_METADATA, fn) !== RequestMethod.GET)
          continue;
        for (const base of bases)
          for (const p of [].concat(
            Reflect.getMetadata(PATH_METADATA, fn) || '',
          )) {
            const full = join(base, p);
            if (full.includes(':') || full.includes('*')) withParam++;
            else routes.add(full);
          }
      }
    }
    for (const w of mod.providers.values()) {
      const inst = w.instance;
      if (!inst || typeof inst !== 'object' || !w.metatype) continue;
      const proto = Object.getPrototypeOf(inst);
      for (const name of Object.getOwnPropertyNames(proto)) {
        // Getters are not touched: reading one can run code.
        const fn = (Object.getOwnPropertyDescriptor(proto, name) || {}).value;
        if (typeof fn !== 'function') continue;
        if (Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn))
          jobs.push({
            label: `${w.metatype.name}.${name}`,
            run: () => fn.call(inst),
          });
      }
    }
  }

  // ---- 1. the routes, once per role of every congregation ----
  const ds = app.get(DataSource);
  const users = await ds.query(
    `SELECT DISTINCT ON (congregation_id, role) id, email, role, congregation_id
       FROM users WHERE is_active AND deleted_at IS NULL
      ORDER BY congregation_id, role,
               NOT EXISTS (SELECT 1 FROM publishers p WHERE p.user_id = users.id), created_at`,
  );
  const jwt = app.get(JwtService, { strict: false });
  const list = [...routes].sort();
  if (process.env.SWEEP_ROUTES_OUT)
    require('fs').writeFileSync(process.env.SWEEP_ROUTES_OUT, list.join('\n'));
  console.log(
    `\n== Reading: ${list.length} GET routes x ${users.length} users (one per role and congregation); ${withParam} routes with a path parameter not swept`,
  );
  // 403 is a role's answer and 400 a query this sweep could not guess; 401
  // and a 429 that stayed mean the sweep itself did not get through — they
  // fail it, so a CLEAN cannot hide a sweep that never reached the code.
  const tally = { ok: 0, refused: 0, still400: 0, failed: 0 };
  // 404 is listed, not failed: some routes answer it by design (/health/dev
  // outside development). A user who got no answer at all fails below.
  const notFound = new Map();
  let withQuery = 0;
  const failures = new Map(); // "status GET route" -> roles
  for (const u of users) {
    // Signed again every five minutes: a token lives fifteen.
    let token = '';
    let signedAt = 0;
    const fresh = () => {
      if (Date.now() - signedAt > 5 * 60_000) {
        token = jwt.sign({
          sub: u.id,
          email: u.email,
          role: u.role,
          congregationId: u.congregation_id,
        });
        signedAt = Date.now();
      }
      return token;
    };
    let answeredForUser = 0;
    for (const route of list) {
      const ask = async (path) => {
        let r = await get(path, fresh());
        if (r.status === 429) {
          await sleep(11_000);
          r = await get(path, fresh());
        }
        await sleep(220); // under 300 a minute per account
        return r;
      };
      let r = await ask(PREFIX + route);
      let shown = route;
      if (r.status === 400) {
        for (const q of queryFor(r.body)) {
          const again = await ask(PREFIX + route + q);
          if (again.status !== 400) {
            r = again;
            shown = route + '?' + q.slice(1).replace(/=[^&]*/g, '=…');
            withQuery++;
            break;
          }
        }
      }
      const status = r.status;
      if (status >= 200 && status < 400) {
        tally.ok++;
        answeredForUser++;
      } else if (status === 403) tally.refused++;
      else if (status === 404)
        notFound.set(shown, (notFound.get(shown) || new Set()).add(u.role));
      else if (status === 400) tally.still400++;
      else {
        tally.failed++;
        const k = `${status || 'no answer'} GET ${PREFIX}${shown}`;
        failures.set(k, (failures.get(k) || new Set()).add(u.role));
      }
    }
    if (answeredForUser === 0) {
      tally.failed++;
      const k = `no route answered for one user`;
      failures.set(k, (failures.get(k) || new Set()).add(u.role));
    }
  }
  console.log(
    `  answered ${tally.ok} (${withQuery} after adding the week/month/year a refusal asked for); 403 for the role ${tally.refused}; still 400 (query not guessed) ${tally.still400}; failed ${tally.failed}`,
  );
  for (const [k, roles] of [...notFound].sort())
    console.log(
      `  note  404 GET ${PREFIX}${k}  [${[...roles].sort().join(', ')}]`,
    );
  for (const [k, roles] of [...failures].sort())
    console.log(`  FAIL  ${k}  [${[...roles].sort().join(', ')}]`);

  // ---- 2. every scheduled job, once ----
  console.log(`\n== Scheduled jobs: ${jobs.length}, each called once`);
  let jobFails = 0;
  if (jobs.length !== registered) {
    jobFails++;
    console.log(
      `  FAIL  found ${jobs.length} job methods, the scheduler has ${registered}`,
    );
  }
  for (const j of jobs.sort((a, b) => a.label.localeCompare(b.label))) {
    const t0 = Date.now();
    try {
      await Promise.race([
        Promise.resolve().then(j.run),
        sleep(JOB_TIMEOUT_MS).then(() => {
          throw Object.assign(new Error('timeout'), { name: 'Timeout' });
        }),
      ]);
      // On the isolated network every push and e-mail fails by design: such
      // logged errors are noted by source, only a where's empty value fails.
      const errs = logged.splice(0);
      const where = [...new Set(errs.filter((x) => / in where '/.test(x)))];
      const other = [...new Set(errs.filter((x) => !/ in where '/.test(x)))];
      const secs = Math.round((Date.now() - t0) / 1000);
      if (where.length) {
        jobFails++;
        console.log(`  FAIL  ${j.label}: ${where.join('; ')}`);
      } else console.log(`  ok    ${j.label} (${secs}s)`);
      if (other.length)
        console.log(
          `  note  ${j.label} logged ${errs.length - where.length} other error(s) from: ${other.join(', ')}`,
        );
    } catch (e) {
      jobFails++;
      logged.splice(0);
      console.log(`  FAIL  ${j.label}: ${describe(e)}`);
    }
  }

  // A job left running past its timeout may hold a connection: never wait
  // on it forever.
  await Promise.race([app.close().catch(() => {}), sleep(15_000)]);
  const bad = tally.failed + jobFails;
  console.log(`\nSWEEP ${bad ? 'FOUND ' + bad + ' FAILURE(S)' : 'CLEAN'}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.log(`SWEEP COULD NOT RUN: ${describe(e)}`);
  if (process.env.SWEEP_DEBUG) console.log(e && e.stack);
  process.exit(2);
});
