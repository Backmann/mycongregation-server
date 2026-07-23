import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartLocation } from '../entities/cart-location.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { CartLocationsService } from './cart-locations.service';
import { CartLocationsController } from './cart-locations.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([CartLocation, Responsibility]),
    AuditLogModule,
  ],
  controllers: [CartLocationsController],
  providers: [CartLocationsService, ResponsibilityGuard],
  exports: [CartLocationsService],
})
export class CartLocationsModule {}
