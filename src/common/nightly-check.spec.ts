/**
 * scripts/nightly-check.sh against a fake machine (8 November 2026).
 *
 * The script reads the production server every night; here every outside
 * command it calls is replaced through the environment, so each failure it
 * must report can be staged on purpose — and a healthy machine must pass.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'nightly-check.sh');
const NOW = 1_800_000_000; // a fixed "now", in seconds

let dir: string;

function stub(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

function copy(name: string, bytes: number, hoursAgo: number): void {
  const p = join(dir, 'backups', name);
  writeFileSync(p, Buffer.alloc(bytes, 1));
  const t = NOW - hoursAgo * 3600;
  utimesSync(p, t, t);
}

/**
 * What backup-db.sh wrote to the journal on a good night — copied from the
 * production server on 8 November 2026 (`journalctl -t backup-db -o cat`).
 */
const GOOD_NIGHT = [
  '30sec: OK 30sec_20261108_030001.sql.gz.gpg (193059 bytes)',
  'offsite 30sec: OK 30sec_20261108_030001.sql.gz.gpg',
  'mycongregation: OK mycongregation_20261108_030001.sql.gz.gpg (1125506 bytes)',
  'offsite mycongregation: OK mycongregation_20261108_030001.sql.gz.gpg',
  'Backup run finished OK',
];

/** A command that prints these journal lines. */
function journal(lines: string[]): string {
  const p = join(dir, `journal-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(p, lines.join('\n') + '\n');
  return `cat '${p}'`;
}

/** A machine where everything is in order; each test breaks one thing. */
function healthy(): Record<string, string> {
  rmSync(join(dir, 'backups'), { recursive: true, force: true });
  spawnSync('mkdir', ['-p', join(dir, 'backups', 'pre-deploy')]);
  copy('mycongregation_2026-11-06.sql.gz.gpg', 1000, 27);
  copy('mycongregation_2026-11-07.sql.gz.gpg', 1010, 3);
  return {
    PATH: process.env.PATH ?? '',
    NOW: String(NOW),
    BACKUP_DIR: join(dir, 'backups'),
    DOCKER: stub('docker', 'echo "true healthy"'),
    OFFSITE_LOG_CMD: journal(GOOD_NIGHT),
    FACTS_CMD: 'echo "FACTS: OK (12 rules)"',
    CRONTAB_CMD: 'echo "0 3 * * * /root/backup-db.sh"',
    DF_CMD:
      'printf "Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/sda1 100 40 60 40%% /\\n"',
  };
}

function run(env: Record<string, string>) {
  const r = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nightly-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('nightly-check.sh', () => {
  it('passes a healthy machine', () => {
    const { code, out } = run(healthy());
    expect(out).toContain('NIGHTLY: OK (0 warning(s))');
    expect(out).not.toContain('FAIL');
    expect(code).toBe(0);
  });

  it('fails when there is no daily copy (pre-deploy copies do not count)', () => {
    const env = healthy();
    rmSync(join(dir, 'backups', 'mycongregation_2026-11-06.sql.gz.gpg'));
    rmSync(join(dir, 'backups', 'mycongregation_2026-11-07.sql.gz.gpg'));
    writeFileSync(
      join(dir, 'backups', 'pre-deploy', 'mycongregation-x.sql.gz.gpg'),
      'x',
    );
    const { code, out } = run(env);
    expect(out).toContain('FAIL daily copy: no file');
    expect(code).toBe(1);
  });

  it('fails when the newest copy is too old', () => {
    const env = healthy();
    rmSync(join(dir, 'backups', 'mycongregation_2026-11-06.sql.gz.gpg'));
    copy('mycongregation_2026-11-07.sql.gz.gpg', 1010, 30);
    const { code, out } = run(env);
    expect(out).toContain('FAIL daily copy: newest is 30h old');
    expect(code).toBe(1);
  });

  it('fails when the newest copy shrank to less than half', () => {
    const env = healthy();
    copy('mycongregation_2026-11-07.sql.gz.gpg', 400, 3);
    const { code, out } = run(env);
    expect(out).toContain('FAIL daily copy: newest is less than half');
    expect(code).toBe(1);
  });

  it('ignores a half-written copy', () => {
    const env = healthy();
    copy('mycongregation_2026-11-08.sql.gz.gpg.partial', 1, 0);
    const { code, out } = run(env);
    expect(out).toContain('OK   daily copy: 3h old, 1010 bytes');
    expect(code).toBe(0);
  });

  it('fails when the offsite copy is not confirmed', () => {
    const env = {
      ...healthy(),
      OFFSITE_LOG_CMD: journal(
        GOOD_NIGHT.filter((l) => !l.startsWith('offsite mycongregation')),
      ),
    };
    const { code, out } = run(env);
    expect(out).toContain('FAIL offsite copy: no «offsite mycongregation: OK»');
    expect(code).toBe(1);
  });

  it('does not take the words of the script output for the journal line', () => {
    const env = {
      ...healthy(),
      OFFSITE_LOG_CMD: journal(['OK   mycongregation: offsite verified']),
    };
    const { code, out } = run(env);
    expect(out).toContain('FAIL offsite copy');
    expect(code).toBe(1);
  });

  it('fails on a failed or mismatched send, even beside a good one', () => {
    for (const bad of [
      'offsite 30sec: SEND FAILED - local copy is intact',
      'offsite mycongregation: MISMATCH after send',
    ]) {
      const env = {
        ...healthy(),
        OFFSITE_LOG_CMD: journal([...GOOD_NIGHT, bad]),
      };
      const { code, out } = run(env);
      expect(out).toContain('FAIL offsite copy: send failed or differs');
      expect(out).toContain(bad.split(':')[0]);
      expect(code).toBe(1);
    }
  });

  it('warns on a filling disk and fails on a full one', () => {
    const warnEnv = {
      ...healthy(),
      DF_CMD: 'printf "h\\n/dev/sda1 1 1 1 80%% /\\n"',
    };
    const w = run(warnEnv);
    expect(w.out).toContain('WARN disk: 80% used');
    expect(w.out).toContain('NIGHTLY: OK (1 warning(s))');
    expect(w.code).toBe(0);

    const failEnv = {
      ...healthy(),
      DF_CMD: 'printf "h\\n/dev/sda1 1 1 1 90%% /\\n"',
    };
    const f = run(failEnv);
    expect(f.out).toContain('FAIL disk: 90% used');
    expect(f.code).toBe(1);
  });

  it('fails when a container is unhealthy or missing', () => {
    const unhealthy = {
      ...healthy(),
      DOCKER: stub(
        'docker-sick',
        '[ "$4" = "mycongregation-postgres" ] && echo "true unhealthy" || echo "true healthy"',
      ),
    };
    const u = run(unhealthy);
    expect(u.out).toContain(
      'FAIL container mycongregation-postgres: true unhealthy',
    );
    expect(u.code).toBe(1);

    const missing = {
      ...healthy(),
      DOCKER: stub('docker-gone', 'exit 1'),
    };
    const m = run(missing);
    expect(m.out).toContain('FAIL container mycongregation-server: not found');
    expect(m.code).toBe(1);
  });

  it('fails when the database rules are broken, naming only the rule', () => {
    const env = {
      ...healthy(),
      FACTS_CMD: 'echo "FACTS: NOT AS EXPECTED:"; echo "  orphan_rows"; exit 1',
    };
    const { code, out } = run(env);
    expect(out).toContain('FAIL database rules: FACTS: NOT AS EXPECTED:');
    expect(out).toContain('orphan_rows');
    expect(code).toBe(1);
  });

  it('fails when the backup job is gone from cron (a commented line is not a job)', () => {
    const env = {
      ...healthy(),
      CRONTAB_CMD: 'echo "# 0 3 * * * /root/backup-db.sh"',
    };
    const { code, out } = run(env);
    expect(out).toContain('FAIL cron: backup-db.sh is not in the crontab');
    expect(code).toBe(1);
  });
});
