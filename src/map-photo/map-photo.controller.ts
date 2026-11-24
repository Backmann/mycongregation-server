import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MapPhotoService } from './map-photo.service';
import { photoTile } from './photo-tile';

/**
 * The aerial photograph behind the map's «Фото» button (R-67, 23 November
 * 2026). Open without login: a pair's link has none, and a tile of a public
 * photograph says nothing about anyone. Only tiles of the Land are given, and
 * a phone panning about stays far under the limit.
 */
@Controller('map-photo')
export class MapPhotoController {
  constructor(private readonly photos: MapPhotoService) {}

  @Public()
  @Throttle({
    short: { limit: 240, ttl: 10_000 },
    long: { limit: 1200, ttl: 60_000 },
  })
  @Get(':z/:x/:y.jpg')
  async tile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Res() res: Response,
  ) {
    const t = photoTile(z, x, y);
    if (!t) throw new NotFoundException();
    const body = await this.photos.tile(t);
    if (!body) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).end();
      return;
    }
    // A photograph of the Land changes once in a few years: let browsers and
    // the edge keep it a week. The same answer for every page that asks — a
    // copy kept by the edge from a request without Origin would otherwise
    // lack the CORS header and blank the map for a week (review, 23 Nov 2026).
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('Access-Control-Allow-Credentials');
    res.removeHeader('Vary');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.status(200).end(body);
  }
}
