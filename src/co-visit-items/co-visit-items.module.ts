import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoVisitItemsController } from './co-visit-items.controller';
import { CoVisitItemsService } from './co-visit-items.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { User } from '../entities/user.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuxiliaryPioneersModule } from '../auxiliary-pioneers/auxiliary-pioneers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoVisitItem,
      SpecialEvent,
      Responsibility,
      User,
      Publisher,
    ]),
    AuxiliaryPioneersModule,
  ],
  controllers: [CoVisitItemsController],
  providers: [CoVisitItemsService, RolesGuard, ResponsibilityGuard],
})
export class CoVisitItemsModule {}
