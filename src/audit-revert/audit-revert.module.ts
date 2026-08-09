import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AssignmentsModule } from '../assignments/assignments.module';
import { LocalNeedsModule } from '../local-needs/local-needs.module';
import { AbsencesModule } from '../absences/absences.module';
import { HallsModule } from '../halls/halls.module';
import { AuditRevertService } from './audit-revert.service';
import { AuditRevertController } from './audit-revert.controller';

/**
 * A module of its own, and that is the point.
 *
 * The feature modules import AuditLogModule to WRITE their history. If the
 * revert lived there it would have to import them back, and the two would
 * depend on each other in a circle. Here the arrows all point one way: this
 * module knows about the features, and none of them knows about it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    AssignmentsModule,
    LocalNeedsModule,
    AbsencesModule,
    HallsModule,
  ],
  controllers: [AuditRevertController],
  providers: [AuditRevertService],
})
export class AuditRevertModule {}
