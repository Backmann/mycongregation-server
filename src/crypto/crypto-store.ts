import { CryptoService } from './crypto.service';

/**
 * Singleton accessor for CryptoService.
 *
 * TypeORM ValueTransformers are attached to entity columns at decorator-
 * evaluation time, which happens when entity files are imported — before
 * NestJS dependency injection has bootstrapped. This module bridges the gap:
 * CryptoModule registers the live service via setCryptoService() during
 * bootstrap, and encryptedTransformer.to()/from() retrieve it lazily at
 * read/write time.
 *
 * Tests inject a service directly via setCryptoService() and clean up via
 * resetCryptoService() in afterEach hooks.
 */

let cryptoInstance: CryptoService | null = null;

export function setCryptoService(service: CryptoService): void {
  cryptoInstance = service;
}

export function getCryptoService(): CryptoService {
  if (!cryptoInstance) {
    throw new Error(
      'CryptoService is not initialized. Import CryptoModule into AppModule before using encryptedTransformer, or call setCryptoService() in tests.',
    );
  }
  return cryptoInstance;
}

export function resetCryptoService(): void {
  cryptoInstance = null;
}
