import { NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BackupsService } from './backups.service';

describe('BackupsService', () => {
  let dir: string;
  let svc: BackupsService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bkp-'));
    process.env.BACKUP_DIR = dir;
    // Our own backups (should be listed) ...
    writeFileSync(join(dir, 'mycongregation_20260626_030001.sql.gz.gpg'), 'A');
    writeFileSync(join(dir, 'mycongregation_20260625_030001.sql.gz.gpg'), 'BB');
    // ... and things that must NOT be listed:
    writeFileSync(join(dir, '30sec_20260626_030001.sql.gz.gpg'), 'X'); // other app
    writeFileSync(join(dir, 'mycongregation_plain.sql.gz'), 'Y'); // not encrypted
    writeFileSync(join(dir, 'random.txt'), 'Z');
    // Explicit mtimes so newest-first ordering is deterministic (writes can
    // otherwise land in the same millisecond and sort unpredictably on CI).
    utimesSync(
      join(dir, 'mycongregation_20260625_030001.sql.gz.gpg'),
      1000,
      1000,
    );
    utimesSync(
      join(dir, 'mycongregation_20260626_030001.sql.gz.gpg'),
      2000,
      2000,
    );
    svc = new BackupsService();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
  });

  it('lists only this tenant encrypted backups, newest first', async () => {
    const files = await svc.list();
    expect(files.map((f) => f.name)).toEqual([
      'mycongregation_20260626_030001.sql.gz.gpg',
      'mycongregation_20260625_030001.sql.gz.gpg',
    ]);
  });

  it('status reports latest + count', async () => {
    const st = await svc.status();
    expect(st.available).toBe(true);
    expect(st.count).toBe(2);
    expect(st.latest?.name).toBe('mycongregation_20260626_030001.sql.gz.gpg');
  });

  it('opens a valid backup for download and streams its bytes', async () => {
    const { file, size } = await svc.openForDownload(
      'mycongregation_20260626_030001.sql.gz.gpg',
    );
    expect(size).toBe(1);
    // Consume the stream fully BEFORE afterEach removes the temp dir,
    // otherwise the lazily-opened ReadStream errors on a deleted file.
    const chunks: Buffer[] = [];
    for await (const c of file.getStream()) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('A');
  });

  it('rejects a foreign app file', async () => {
    await expect(
      svc.openForDownload('30sec_20260626_030001.sql.gz.gpg'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects path traversal', async () => {
    await expect(
      svc.openForDownload('../../etc/passwd'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns empty list when dir is missing', async () => {
    process.env.BACKUP_DIR = join(dir, 'does-not-exist');
    const svc2 = new BackupsService();
    expect(await svc2.list()).toEqual([]);
  });
});
