import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM authenticated encryption service.
 *
 * Format on disk: enc:v1:<base64(iv)>:<base64(ciphertext + auth_tag)>
 * - Algorithm:  AES-256-GCM (RFC 5288)
 * - Key size:   32 bytes (256 bits)
 * - IV size:    12 bytes (96 bits, NIST SP 800-38D recommendation for GCM)
 * - Auth tag:   16 bytes (128 bits, appended to ciphertext)
 *
 * Properties:
 * - Authenticated: tampering or wrong key throws on decrypt
 * - Probabilistic: same plaintext yields different ciphertext each time (random IV)
 * - Migration-safe: decrypt() passes through non-prefixed strings unchanged,
 *   so encrypted and plaintext rows can coexist during phased rollout
 *
 * Null and undefined inputs pass through both encrypt() and decrypt().
 */
@Injectable()
export class CryptoService {
  private static readonly VERSION = 'v1';
  private static readonly IV_BYTES = 12;
  private static readonly AUTH_TAG_BYTES = 16;
  private static readonly KEY_BYTES = 32;
  private static readonly PREFIX = `enc:${CryptoService.VERSION}:`;

  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (!Buffer.isBuffer(key)) {
      throw new Error('CryptoService: key must be a Buffer');
    }
    if (key.length !== CryptoService.KEY_BYTES) {
      throw new Error(
        `CryptoService: key must be ${CryptoService.KEY_BYTES} bytes (got ${key.length})`,
      );
    }
    this.key = key;
  }

  /**
   * Encrypt a string with AES-256-GCM. Returns formatted ciphertext or
   * passes through null/undefined unchanged.
   */
  encrypt(plaintext: string | null | undefined): string | null | undefined {
    if (plaintext === null) return null;
    if (plaintext === undefined) return undefined;
    if (typeof plaintext !== 'string') {
      throw new Error(
        'CryptoService.encrypt: input must be string, null, or undefined',
      );
    }

    const iv = randomBytes(CryptoService.IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([ciphertext, authTag]);

    return `${CryptoService.PREFIX}${iv.toString('base64')}:${payload.toString('base64')}`;
  }

  /**
   * Decrypt an encrypted string. If the input doesn't start with enc:v1:,
   * it's returned as-is (migration support: plaintext rows from before
   * encryption was applied to the column).
   *
   * Throws if:
   * - The ciphertext has been tampered with (auth tag mismatch)
   * - The wrong key is used to decrypt
   * - The format claims v1 but is malformed
   */
  decrypt(input: string | null | undefined): string | null | undefined {
    if (input === null) return null;
    if (input === undefined) return undefined;
    if (typeof input !== 'string') {
      throw new Error(
        'CryptoService.decrypt: input must be string, null, or undefined',
      );
    }
    if (!CryptoService.isEncrypted(input)) {
      // Plaintext passthrough — supports mixed-mode reads during migration
      return input;
    }

    const parts = input.split(':');
    // Expected shape: ['enc', 'v1', '<iv-base64>', '<payload-base64>']
    if (parts.length !== 4) {
      throw new Error('CryptoService.decrypt: malformed enc:v1 payload');
    }
    const [, , ivB64, payloadB64] = parts;

    const iv = Buffer.from(ivB64, 'base64');
    const payload = Buffer.from(payloadB64, 'base64');

    if (iv.length !== CryptoService.IV_BYTES) {
      throw new Error(
        `CryptoService.decrypt: IV must be ${CryptoService.IV_BYTES} bytes (got ${iv.length})`,
      );
    }
    if (payload.length < CryptoService.AUTH_TAG_BYTES) {
      throw new Error('CryptoService.decrypt: payload too short for auth tag');
    }

    const ciphertext = payload.subarray(
      0,
      payload.length - CryptoService.AUTH_TAG_BYTES,
    );
    const authTag = payload.subarray(
      payload.length - CryptoService.AUTH_TAG_BYTES,
    );

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  /**
   * True if `value` is a string starting with the version prefix `enc:v1:`.
   * Does NOT validate the rest of the payload — use decrypt() for that.
   */
  static isEncrypted(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(CryptoService.PREFIX);
  }
}
