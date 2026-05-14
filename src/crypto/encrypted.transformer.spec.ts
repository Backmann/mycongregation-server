import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';
import { resetCryptoService, setCryptoService } from './crypto-store';
import { encryptedTransformer } from './encrypted.transformer';

describe('encryptedTransformer', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = new CryptoService(randomBytes(32));
    setCryptoService(crypto);
  });

  afterEach(() => {
    resetCryptoService();
  });

  describe('to (entity → database)', () => {
    it('encrypts a string value', () => {
      const result = encryptedTransformer.to('plaintext') as string;
      expect(result).toMatch(/^enc:v1:/);
      expect(crypto.decrypt(result)).toBe('plaintext');
    });

    it('passes null through', () => {
      expect(encryptedTransformer.to(null)).toBeNull();
    });

    it('passes undefined through', () => {
      expect(encryptedTransformer.to(undefined)).toBeUndefined();
    });

    it('encrypts Unicode strings', () => {
      const result = encryptedTransformer.to('Привет мир 🌍') as string;
      expect(crypto.decrypt(result)).toBe('Привет мир 🌍');
    });

    it('encrypts empty strings as ciphertext', () => {
      const result = encryptedTransformer.to('') as string;
      expect(result).toMatch(/^enc:v1:/);
      expect(crypto.decrypt(result)).toBe('');
    });

    it('produces different ciphertext for same plaintext on each call', () => {
      const a = encryptedTransformer.to('repeat');
      const b = encryptedTransformer.to('repeat');
      expect(a).not.toBe(b);
    });
  });

  describe('from (database → entity)', () => {
    it('decrypts an encrypted value', () => {
      const encrypted = crypto.encrypt('hello') as string;
      expect(encryptedTransformer.from(encrypted)).toBe('hello');
    });

    it('passes null through', () => {
      expect(encryptedTransformer.from(null)).toBeNull();
    });

    it('passes undefined through', () => {
      expect(encryptedTransformer.from(undefined)).toBeUndefined();
    });

    it('passes plaintext through (migration support)', () => {
      expect(encryptedTransformer.from('legacy plaintext')).toBe(
        'legacy plaintext',
      );
    });

    it('throws on tampered ciphertext', () => {
      const encrypted = crypto.encrypt('secret') as string;
      const tampered = encrypted.slice(0, -4) + 'XXXX';
      expect(() => encryptedTransformer.from(tampered)).toThrow();
    });
  });

  describe('round-trip via transformer', () => {
    it('to() then from() returns the original value', () => {
      const original = 'Some sensitive notes';
      const stored = encryptedTransformer.to(original);
      const retrieved = encryptedTransformer.from(stored as string);
      expect(retrieved).toBe(original);
    });

    it('preserves null through round-trip', () => {
      const stored = encryptedTransformer.to(null);
      expect(encryptedTransformer.from(stored as null)).toBeNull();
    });

    it('round-trips Unicode correctly', () => {
      const original = 'Адрес: ул. Ленина 1, кв. 42 🏠';
      const stored = encryptedTransformer.to(original);
      expect(encryptedTransformer.from(stored as string)).toBe(original);
    });
  });

  describe('when service is not initialized', () => {
    beforeEach(() => {
      resetCryptoService();
    });

    it('to() throws clearly', () => {
      expect(() => encryptedTransformer.to('x')).toThrow(/not initialized/);
    });

    it('from() throws clearly', () => {
      expect(() => encryptedTransformer.from('enc:v1:abc:def')).toThrow(
        /not initialized/,
      );
    });
  });
});
