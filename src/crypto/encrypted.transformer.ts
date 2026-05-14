import { ValueTransformer } from 'typeorm';
import { getCryptoService } from './crypto-store';

/**
 * TypeORM ValueTransformer that encrypts values on write and decrypts on
 * read, delegating to the singleton CryptoService.
 *
 * Use on text columns containing sensitive data:
 *
 *   @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
 *   sensitiveNotes!: string | null;
 *
 * Behavior:
 * - null/undefined values pass through unchanged in both directions
 * - On read, plaintext values (without enc:v1: prefix) are returned as-is,
 *   enabling phased rollout where new writes are encrypted but legacy
 *   rows remain plaintext until migrated
 * - Tampered or malformed encrypted values cause from() to throw,
 *   surfacing as a TypeORM query error
 *
 * Requires CryptoService to be registered via setCryptoService(). Handled
 * automatically by CryptoModule at application startup.
 */
export const encryptedTransformer: ValueTransformer = {
  to(value: string | null | undefined): string | null | undefined {
    return getCryptoService().encrypt(value);
  },
  from(value: string | null | undefined): string | null | undefined {
    return getCryptoService().decrypt(value);
  },
};
