import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CleaningAssignment,
      ServiceGroup,
      Publisher,
      Responsibility,
    ]),
  ],
  controllers: [CleaningController],
  providers: [CleaningService, ResponsibilityGuard],
})
export class CleaningModule {}
