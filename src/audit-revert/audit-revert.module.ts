import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AssignmentsModule } from '../assignments/assignments.module';
import { LocalNeedsModule } from '../local-needs/local-needs.module';
import { AbsencesModule } from '../absences/absences.module';
import { HallsModule } from '../halls/halls.module';
import { PublishersModule } from '../publishers/publishers.module';
import { ServiceGroupsModule } from '../service-groups/service-groups.module';
import { CartLocationsModule } from '../cart-locations/cart-locations.module';
import { CircuitOverseerModule } from '../circuit-overseer/circuit-overseer.module';
import { ExternalCongregationsModule } from '../external-congregations/external-congregations.module';
import { SpecialEventsModule } from '../special-events/special-events.module';
import { PioneerSchoolModule } from '../pioneer-school/pioneer-school.module';
import { CoVisitItemsModule } from '../co-visit-items/co-visit-items.module';
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
    PublishersModule,
    ServiceGroupsModule,
    CartLocationsModule,
    CircuitOverseerModule,
    ExternalCongregationsModule,
    SpecialEventsModule,
    PioneerSchoolModule,
    CoVisitItemsModule,
  ],
  controllers: [AuditRevertController],
  providers: [AuditRevertService],
})
export class AuditRevertModule {}
