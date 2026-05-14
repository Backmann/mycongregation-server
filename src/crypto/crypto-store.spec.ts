import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';
import {
  getCryptoService,
  resetCryptoService,
  setCryptoService,
} from './crypto-store';

describe('crypto-store', () => {
  beforeEach(() => {
    resetCryptoService();
  });

  afterAll(() => {
    resetCryptoService();
  });

  describe('getCryptoService', () => {
    it('throws when no service has been registered', () => {
      expect(() => getCryptoService()).toThrow(/not initialized/);
    });

    it('returns the registered service', () => {
      const svc = new CryptoService(randomBytes(32));
      setCryptoService(svc);
      expect(getCryptoService()).toBe(svc);
    });

    it('returns the most recently registered service', () => {
      const a = new CryptoService(randomBytes(32));
      const b = new CryptoService(randomBytes(32));
      setCryptoService(a);
      setCryptoService(b);
      expect(getCryptoService()).toBe(b);
    });
  });

  describe('resetCryptoService', () => {
    it('clears the registered service', () => {
      setCryptoService(new CryptoService(randomBytes(32)));
      expect(() => getCryptoService()).not.toThrow();
      resetCryptoService();
      expect(() => getCryptoService()).toThrow(/not initialized/);
    });
  });
});
