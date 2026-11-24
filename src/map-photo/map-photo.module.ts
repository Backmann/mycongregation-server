import { Module } from '@nestjs/common';
import { MapPhotoController } from './map-photo.controller';
import { MapPhotoService } from './map-photo.service';

@Module({
  controllers: [MapPhotoController],
  providers: [MapPhotoService],
})
export class MapPhotoModule {}
