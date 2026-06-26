import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createReadStream, promises as fsp } from 'fs';
import { join } from 'path';

/**
 * Serves the encrypted database backups produced by the host cron
 * (/root/backups/*.sql.gz.gpg), exposed read-only to the app container via a
 * volume mount at BACKUP_DIR. The app does NOT create backups — it only reads
 * the already-encrypted artifacts. Files are GPG-encrypted with the offline
 * public key, so serving them is safe: useless without the private key.
 *
 * Only this tenant's own backups (mycongregation_*) are ever exposed; the
 * strict filename pattern also blocks path traversal.
 */
export interface BackupFile {
  name: string;
  size: number;
  modifiedAt: string;
}

const NAME_RE = /^mycongregation_\d{8}_\d{6}\.sql\.gz\.gpg$/;

@Injectable()
export class BackupsService {
  private readonly dir = process.env.BACKUP_DIR || '/backups';

  async list(): Promise<BackupFile[]> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const names = entries.filter((n) => NAME_RE.test(n));
    const files = await Promise.all(
      names.map(async (name) => {
        const st = await fsp.stat(join(this.dir, name));
        return {
          name,
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
        };
      }),
    );
    return files.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  }

  async status(): Promise<{
    available: boolean;
    count: number;
    latest: BackupFile | null;
  }> {
    const files = await this.list();
    return {
      available: files.length > 0,
      count: files.length,
      latest: files[0] ?? null,
    };
  }

  /** Resolve a requested name to an absolute path, rejecting anything that
   * does not match the strict backup-filename pattern (blocks traversal). */
  private resolveSafe(name: string): string {
    if (!NAME_RE.test(name)) {
      throw new NotFoundException('Backup not found');
    }
    return join(this.dir, name);
  }

  async openForDownload(
    name: string,
  ): Promise<{ file: StreamableFile; size: number }> {
    const path = this.resolveSafe(name);
    let size: number;
    try {
      size = (await fsp.stat(path)).size;
    } catch {
      throw new NotFoundException('Backup not found');
    }
    return { file: new StreamableFile(createReadStream(path)), size };
  }
}
