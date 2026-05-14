import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;
  let key: Buffer;

  beforeEach(() => {
    key = randomBytes(32);
    service = new CryptoService(key);
  });

  describe('constructor', () => {
    it('accepts a 32-byte Buffer', () => {
      expect(() => new CryptoService(randomBytes(32))).not.toThrow();
    });

    it('throws on key shorter than 32 bytes', () => {
      expect(() => new CryptoService(randomBytes(16))).toThrow(/32 bytes/);
    });

    it('throws on key longer than 32 bytes', () => {
      expect(() => new CryptoService(randomBytes(64))).toThrow(/32 bytes/);
    });

    it('throws on non-Buffer key', () => {
      // @ts-expect-error - testing runtime type guard
      expect(() => new CryptoService('not a buffer')).toThrow(/Buffer/);
    });
  });

  describe('encrypt → decrypt round-trip', () => {
    it('preserves a simple ASCII string', () => {
      const plain = 'Hello, World!';
      expect(service.decrypt(service.encrypt(plain))).toBe(plain);
    });

    it('preserves Unicode (Cyrillic + CJK + emoji)', () => {
      const plain = 'Привет, мир! 你好世界 🌍✨';
      expect(service.decrypt(service.encrypt(plain))).toBe(plain);
    });

    it('preserves an empty string', () => {
      const encrypted = service.encrypt('') as string;
      expect(typeof encrypted).toBe('string');
      expect(encrypted).toMatch(/^enc:v1:/);
      expect(service.decrypt(encrypted)).toBe('');
    });

    it('preserves a large string (10 KB)', () => {
      const plain = 'a'.repeat(10_000);
      expect(service.decrypt(service.encrypt(plain))).toBe(plain);
    });

    it('preserves a string with newlines and special chars', () => {
      const plain = 'Line 1\nLine 2\r\nLine 3\t"quoted"';
      expect(service.decrypt(service.encrypt(plain))).toBe(plain);
    });
  });

  describe('format', () => {
    it('produces output starting with enc:v1:', () => {
      const encrypted = service.encrypt('test') as string;
      expect(encrypted.startsWith('enc:v1:')).toBe(true);
    });

    it('produces output with exactly 4 colon-separated parts', () => {
      const encrypted = service.encrypt('test') as string;
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('enc');
      expect(parts[1]).toBe('v1');
    });

    it('uses a 12-byte IV', () => {
      const encrypted = service.encrypt('x') as string;
      const iv = Buffer.from(encrypted.split(':')[2], 'base64');
      expect(iv.length).toBe(12);
    });

    it('produces different ciphertext on each call (random IV)', () => {
      const plain = 'same input';
      const a = service.encrypt(plain);
      const b = service.encrypt(plain);
      expect(a).not.toBe(b);
      expect(service.decrypt(a)).toBe(plain);
      expect(service.decrypt(b)).toBe(plain);
    });
  });

  describe('null/undefined passthrough', () => {
    it('encrypt(null) → null', () => {
      expect(service.encrypt(null)).toBeNull();
    });

    it('encrypt(undefined) → undefined', () => {
      expect(service.encrypt(undefined)).toBeUndefined();
    });

    it('decrypt(null) → null', () => {
      expect(service.decrypt(null)).toBeNull();
    });

    it('decrypt(undefined) → undefined', () => {
      expect(service.decrypt(undefined)).toBeUndefined();
    });
  });

  describe('migration: plaintext passthrough on decrypt', () => {
    it('decrypts a plaintext string as-is when no enc:v1: prefix', () => {
      expect(service.decrypt('I am plain text')).toBe('I am plain text');
    });

    it('preserves plaintext that happens to contain colons', () => {
      expect(service.decrypt('1:2:3:4')).toBe('1:2:3:4');
    });

    it('preserves plaintext that starts with enc: but not enc:v1:', () => {
      expect(service.decrypt('enc:v0:something')).toBe('enc:v0:something');
    });
  });

  describe('tampering detection (AES-GCM auth tag)', () => {
    it('throws when ciphertext has been modified', () => {
      const encrypted = service.encrypt('secret') as string;
      const parts = encrypted.split(':');
      const tampered = Buffer.from(parts[3], 'base64');
      tampered[0] = tampered[0] ^ 0x01;
      const tamperedStr = `${parts[0]}:${parts[1]}:${parts[2]}:${tampered.toString('base64')}`;
      expect(() => service.decrypt(tamperedStr)).toThrow();
    });

    it('throws when IV has been modified', () => {
      const encrypted = service.encrypt('secret') as string;
      const parts = encrypted.split(':');
      const tamperedIv = Buffer.from(parts[2], 'base64');
      tamperedIv[0] = tamperedIv[0] ^ 0x01;
      const tamperedStr = `${parts[0]}:${parts[1]}:${tamperedIv.toString('base64')}:${parts[3]}`;
      expect(() => service.decrypt(tamperedStr)).toThrow();
    });

    it('throws when auth tag has been modified', () => {
      const encrypted = service.encrypt('secret') as string;
      const parts = encrypted.split(':');
      const payload = Buffer.from(parts[3], 'base64');
      payload[payload.length - 1] = payload[payload.length - 1] ^ 0x01;
      const tamperedStr = `${parts[0]}:${parts[1]}:${parts[2]}:${payload.toString('base64')}`;
      expect(() => service.decrypt(tamperedStr)).toThrow();
    });

    it('throws when decrypted with a different key', () => {
      const encrypted = service.encrypt('secret');
      const otherService = new CryptoService(randomBytes(32));
      expect(() => otherService.decrypt(encrypted)).toThrow();
    });
  });

  describe('malformed input', () => {
    it('throws when enc:v1: payload has wrong number of parts', () => {
      expect(() => service.decrypt('enc:v1:only-two-parts')).toThrow(
        /malformed/,
      );
    });

    it('throws when IV has wrong byte length', () => {
      const tooShortIv = Buffer.from('short').toString('base64');
      const payload = randomBytes(32).toString('base64');
      expect(() => service.decrypt(`enc:v1:${tooShortIv}:${payload}`)).toThrow(
        /IV/,
      );
    });

    it('throws when payload is too short to contain auth tag', () => {
      const iv = randomBytes(12).toString('base64');
      const tooShortPayload = Buffer.from([1, 2, 3]).toString('base64');
      expect(() =>
        service.decrypt(`enc:v1:${iv}:${tooShortPayload}`),
      ).toThrow();
    });
  });

  describe('isEncrypted (static)', () => {
    it('returns true for properly prefixed string', () => {
      expect(CryptoService.isEncrypted('enc:v1:abc:def')).toBe(true);
    });

    it('returns false for unprefixed string', () => {
      expect(CryptoService.isEncrypted('plain text')).toBe(false);
    });

    it('returns false for string with wrong version', () => {
      expect(CryptoService.isEncrypted('enc:v2:abc:def')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(CryptoService.isEncrypted('')).toBe(false);
    });

    it('returns false for null', () => {
      expect(CryptoService.isEncrypted(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(CryptoService.isEncrypted(undefined)).toBe(false);
    });

    it('returns false for non-string types', () => {
      expect(CryptoService.isEncrypted(123)).toBe(false);
      expect(CryptoService.isEncrypted({})).toBe(false);
      expect(CryptoService.isEncrypted([])).toBe(false);
    });
  });

  describe('non-string input on encrypt/decrypt', () => {
    it('encrypt throws on number input', () => {
      // @ts-expect-error - testing runtime guard
      expect(() => service.encrypt(123)).toThrow();
    });

    it('decrypt throws on number input', () => {
      // @ts-expect-error - testing runtime guard
      expect(() => service.decrypt(123)).toThrow();
    });
  });
});
