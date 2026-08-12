import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      const root = appController.getHello();
      expect(root).toContain('mycongregation API');
      expect(root).toContain('https://mycongregation.org');
      // The front door names the service and points at the app. It must NOT
      // list routes: that would hand a map to whoever was merely curious.
      expect(root).not.toMatch(/\/api\/[a-z]/);
    });
  });

  describe('health', () => {
    it('returns ok status with uptime and ISO timestamp', () => {
      const result = appController.getHealth();

      expect(result.status).toBe('ok');
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof result.timestamp).toBe('string');

      // Timestamp parses as valid ISO 8601
      const parsed = new Date(result.timestamp);
      expect(parsed.toISOString()).toBe(result.timestamp);
    });

    it('returns a recent timestamp (within 1 second of now)', () => {
      const before = Date.now();
      const result = appController.getHealth();
      const after = Date.now();

      const ts = new Date(result.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
