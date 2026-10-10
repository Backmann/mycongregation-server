import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const PREPARE_LEADS = ['2w', '1m', '2m'] as const;
export type PrepareLead = (typeof PREPARE_LEADS)[number];

export const UNPUBLISHED_POLICIES = ['publish_7d', 'remind'] as const;
export type UnpublishedPolicy = (typeof UNPUBLISHED_POLICIES)[number];

/**
 * How a congregation's field-service months are prepared (October 2026).
 *
 * One row per congregation, created with the defaults the first time anybody
 * asks. The calendar switches are read by the generator now; the automatic
 * preparation reads the rest when it exists — the switches are stored here
 * already so the window that sets them has somewhere to write.
 */
@Entity('field_service_settings')
export class FieldServiceSettings {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  /** A day inside an assembly or convention gets no meeting. */
  @Column({ type: 'boolean', default: true })
  skipAssemblies!: boolean;

  /** The week of the circuit overseer's visit takes its outings from the
   * visit's own schedule; the template leaves that week alone. */
  @Column({ type: 'boolean', default: true })
  coVisitFromSchedule!: boolean;

  /** Prepare the month without being asked. */
  @Column({ type: 'boolean', default: false })
  autoPrepare!: boolean;

  /** How far ahead: two weeks, a month, two months. */
  @Column({ type: 'varchar', length: 5, default: '1m' })
  prepareLead!: PrepareLead;

  /** Pick conductors as each slot's rule says, or leave every one empty. */
  @Column({ type: 'boolean', default: true })
  autoPickConductors!: boolean;

  /** A draft nobody published: announce it seven days before the month, or
   * only remind. */
  @Column({ type: 'varchar', length: 20, default: 'publish_7d' })
  unpublishedPolicy!: UnpublishedPolicy;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
