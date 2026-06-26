import { MigrationInterface, QueryRunner } from 'typeorm';
import { CryptoService } from '../crypto/crypto.service';

/**
 * One-time backfill: encrypt the public-talk coordinator's external-contact
 * fields that became encrypted columns in this release. Existing plaintext
 * rows are re-written as enc:v1: ciphertext so nothing sensitive remains in
 * plaintext at rest. Uses the SAME CryptoService the app uses, so the format
 * is guaranteed to match what the column transformer expects on read.
 *
 * Idempotent: values already starting with enc:v1: are skipped, so re-running
 * (or running after some rows were created post-deploy and thus already
 * encrypted by the transformer) is a no-op for those rows.
 */
const TARGETS: { table: string; columns: string[] }[] = [
  { table: 'visiting_speakers', columns: ['phone', 'note'] },
  {
    table: 'external_congregations',
    columns: ['contact_name', 'contact_phone', 'note'],
  },
];

function crypto(): CryptoService {
  const b64 = process.env.KEK_BASE64;
  if (!b64) {
    throw new Error(
      'EncryptVisitingSpeakerContact: KEK_BASE64 is required to run this backfill',
    );
  }
  return new CryptoService(Buffer.from(b64, 'base64'));
}

export class EncryptVisitingSpeakerContact1816000000000 implements MigrationInterface {
  name = 'EncryptVisitingSpeakerContact1816000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const svc = crypto();
    for (const { table, columns } of TARGETS) {
      const rows: Record<string, string | null>[] = await queryRunner.query(
        `SELECT id, ${columns.join(', ')} FROM "${table}"`,
      );
      for (const row of rows) {
        const sets: string[] = [];
        const params: (string | null)[] = [];
        let i = 1;
        for (const col of columns) {
          const val = row[col];
          if (
            typeof val === 'string' &&
            val.length > 0 &&
            !val.startsWith('enc:v1:')
          ) {
            sets.push(`"${col}" = $${i++}`);
            params.push(svc.encrypt(val) as string);
          }
        }
        if (sets.length > 0) {
          params.push(row.id as string);
          await queryRunner.query(
            `UPDATE "${table}" SET ${sets.join(', ')} WHERE id = $${i}`,
            params,
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const svc = crypto();
    for (const { table, columns } of TARGETS) {
      const rows: Record<string, string | null>[] = await queryRunner.query(
        `SELECT id, ${columns.join(', ')} FROM "${table}"`,
      );
      for (const row of rows) {
        const sets: string[] = [];
        const params: (string | null)[] = [];
        let i = 1;
        for (const col of columns) {
          const val = row[col];
          if (typeof val === 'string' && val.startsWith('enc:v1:')) {
            sets.push(`"${col}" = $${i++}`);
            params.push(svc.decrypt(val) as string);
          }
        }
        if (sets.length > 0) {
          params.push(row.id as string);
          await queryRunner.query(
            `UPDATE "${table}" SET ${sets.join(', ')} WHERE id = $${i}`,
            params,
          );
        }
      }
    }
  }
}
