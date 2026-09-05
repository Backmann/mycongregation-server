import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { PioneerSpellsService } from './pioneer-spells.service';

/**
 * Spells of permanent pioneer service. The service is the ONLY writer — every
 * path that changes the card goes through it, so the two can never drift.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PioneerSpell])],
  providers: [PioneerSpellsService],
  exports: [PioneerSpellsService],
})
export class PioneerSpellsModule {}
