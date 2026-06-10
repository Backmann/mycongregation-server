import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Publisher } from '../entities/publisher.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { CartShiftParticipant } from '../entities/cart-shift-participant.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { MeService } from './me.service';
import { MeController } from './me.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Publisher,
      Assignment,
      Duty,
      CleaningAssignment,
      CartShiftParticipant,
      FieldServiceMeeting,
    ]),
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
