import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartLocation } from '../entities/cart-location.entity';
import { CartLocationsService } from './cart-locations.service';
import { CartLocationsController } from './cart-locations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CartLocation])],
  controllers: [CartLocationsController],
  providers: [CartLocationsService],
  exports: [CartLocationsService],
})
export class CartLocationsModule {}
