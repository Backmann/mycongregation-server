import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';

interface HealthResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Liveness probe. No auth required, no DB hit.
   *
   * Returns 200 if the Node process is responsive — the request reached
   * the controller, so the process is up and serving HTTP. Useful for:
   *   - uptime monitors (Better Stack, etc.)
   *   - curl smoke tests after deploy
   *   - future load balancer health checks
   *
   * Does NOT verify DB / Redis / external services — that would be a
   * "readiness" probe and lives at /api/health/ready (not implemented yet).
   * A simple liveness endpoint is sufficient for current production needs.
   */
  @Public()
  @Get('health')
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
