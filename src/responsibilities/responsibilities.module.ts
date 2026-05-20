import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { ResponsibilitiesService } from './responsibilities.service';
import { ResponsibilitiesController } from './responsibilities.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Responsibility, User])],
  controllers: [ResponsibilitiesController],
  providers: [ResponsibilitiesService, ResponsibilityGuard],
  // Export the service, the guard, and the Responsibility repository so that
  // future feature modules (duties, cleaning, cart witnessing, schedule
  // editing) can apply @UseGuards(ResponsibilityGuard) on their endpoints.
  exports: [ResponsibilitiesService, ResponsibilityGuard, TypeOrmModule],
})
export class ResponsibilitiesModule {}
