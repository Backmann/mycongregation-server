import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Which build of the app the server expects, and where to get it.
 *
 * Public because the answer carries nothing private and the app has to be able
 * to ask BEFORE anybody signs in — an app too old to talk to this server should
 * say so on its first screen, not after a failed request.
 */
@Controller('app-version')
export class AppVersionController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get()
  get() {
    return {
      current: this.config.get<string | null>('appVersion.current') ?? null,
      minimum: this.config.get<string | null>('appVersion.minimum') ?? null,
      downloadUrl: this.config.get<string>('appVersion.downloadUrl'),
    };
  }
}
