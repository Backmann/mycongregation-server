import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';
import { CryptoModule } from './crypto.module';
import { getCryptoService, resetCryptoService } from './crypto-store';

describe('CryptoModule', () => {
  afterEach(() => {
    resetCryptoService();
  });

  async function buildModule(envOverrides: Record<string, string> = {}) {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => envOverrides],
        }),
        CryptoModule,
      ],
    }).compile();
  }

  it('provides CryptoService when KEK_BASE64 is a valid 32-byte key', async () => {
    const key = randomBytes(32).toString('base64');
    const moduleRef = await buildModule({ KEK_BASE64: key });
    const service = moduleRef.get(CryptoService);
    expect(service).toBeInstanceOf(CryptoService);

    const encrypted = service.encrypt('hello') as string;
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(service.decrypt(encrypted)).toBe('hello');
  });

  it('registers the service in crypto-store on bootstrap', async () => {
    const key = randomBytes(32).toString('base64');
    await buildModule({ KEK_BASE64: key });

    expect(() => getCryptoService()).not.toThrow();
    expect(getCryptoService()).toBeInstanceOf(CryptoService);
  });

  it('throws when KEK_BASE64 is missing', async () => {
    await expect(buildModule({})).rejects.toThrow();
  });

  it('throws when KEK_BASE64 decodes to fewer than 32 bytes', async () => {
    const shortKey = randomBytes(16).toString('base64');
    await expect(buildModule({ KEK_BASE64: shortKey })).rejects.toThrow(
      /32 bytes/,
    );
  });

  it('throws when KEK_BASE64 decodes to more than 32 bytes', async () => {
    const longKey = randomBytes(64).toString('base64');
    await expect(buildModule({ KEK_BASE64: longKey })).rejects.toThrow(
      /32 bytes/,
    );
  });

  it('does not register the service if construction failed', async () => {
    resetCryptoService();
    try {
      await buildModule({});
    } catch {
      // expected
    }
    expect(() => getCryptoService()).toThrow(/not initialized/);
  });
});
