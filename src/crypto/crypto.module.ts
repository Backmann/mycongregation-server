import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';
import { setCryptoService } from './crypto-store';

/**
 * Provides CryptoService initialized from the KEK_BASE64 environment variable
 * and registers it in the global crypto-store so that encryptedTransformer
 * (used in entity column metadata) can access it at read/write time.
 *
 * KEK_BASE64 must decode to exactly 32 bytes. Generate with:
 *   openssl rand -base64 32
 *
 * Bootstrap fails fast if KEK_BASE64 is missing or malformed — preventing the
 * app from starting in a state where it could overwrite encrypted data with
 * a different key.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CryptoService,
      useFactory: (config: ConfigService) => {
        const keyBase64 = config.getOrThrow<string>('KEK_BASE64');
        const key = Buffer.from(keyBase64, 'base64');
        const service = new CryptoService(key);
        setCryptoService(service);
        return service;
      },
      inject: [ConfigService],
    },
  ],
  exports: [CryptoService],
})
export class CryptoModule {}
