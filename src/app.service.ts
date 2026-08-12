import { Injectable } from '@nestjs/common';

/**
 * What the root of the API says to whoever opens it in a browser.
 *
 * It said «Hello World!» — the placeholder that comes with a new project, and
 * it had been sitting on a live address for months. Anybody who typed the
 * address saw something that looked unfinished, and there is no reason for the
 * front door of a working service to look abandoned.
 *
 * Deliberately says almost nothing beyond «this is an API, the people-facing
 * side is over there». A root that enumerated its own routes would be handing a
 * map to whoever was curious, and nobody who belongs here needs it.
 */
@Injectable()
export class AppService {
  getHello(): string {
    return [
      'mycongregation API',
      '',
      'This is the interface the app talks to, not a page to read.',
      'The app itself: https://mycongregation.org',
      '',
      'Independent, community-built tool.',
      'Not affiliated with or endorsed by any organization.',
    ].join('\n');
  }
}
