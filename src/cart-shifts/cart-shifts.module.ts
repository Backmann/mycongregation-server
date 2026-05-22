import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartShift } from '../entities/cart-shift.entity';
import { CartShiftParticipant } from '../entities/cart-shift-participant.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { CartShiftsService } from './cart-shifts.service';
import { CartShiftsController } from './cart-shifts.controller';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CartShift,
      CartShiftParticipant,
      Publisher,
      Responsibility,
    ]),
  ],
  controllers: [CartShiftsController],
  providers: [CartShiftsService, ResponsibilityGuard],
})
export class CartShiftsModule {}
