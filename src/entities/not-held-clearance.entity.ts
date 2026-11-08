import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A part made «cancelled», with the state it had — given back as it was. */
export interface ClearedPart {
  id: string;
  status: string;
}

/** A duty as it stood before it was taken off — enough to put it back. */
export interface ClearedDuty {
  dutyType: string;
  slotIndex: number;
  sortOrder: number;
  customLabel: string | null;
  publisherId: string | null;
  notes: string | null;
}

/**
 * Assignments taken off a meeting that is not held (8 November 2026).
 *
 * A convention, the Memorial or an event «no meeting that day» takes a
 * meeting away, and its programme lines and duties stay behind with nobody
 * to give them. The person who keeps that meeting takes them off — and this
 * row remembers what was taken, so that when the event moves and the meeting
 * is held again, «вернуть» puts everything back.
 *
 * Parts are not deleted: they become «cancelled», the programme's own state
 * for a part that is not given (it tells the talk coordinator about a guest
 * speaker and comes back with the meeting). Duties have no such state; their
 * rows are removed and kept here as they were.
 */
@Entity('not_held_clearances')
@Index(['congregationId', 'weekStartDate'])
export class NotHeldClearance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'date' })
  weekStartDate!: string;

  /** midweek or weekend. */
  @Column({ type: 'varchar', length: 16 })
  eventType!: string;

  /** congress, memorial or replaced — why the meeting was not held. */
  @Column({ type: 'varchar', length: 16 })
  reason!: string;

  @Column({ type: 'uuid', nullable: true })
  reasonEventId!: string | null;

  /** The parts made «cancelled» by this clearance. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  parts!: ClearedPart[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  duties!: ClearedDuty[];

  @Column({ type: 'uuid', nullable: true })
  clearedById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  clearedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  restoredAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  restoredById!: string | null;

  /**
   * When the meeting's editors were told it is held again and this can be
   * given back — once per record.
   */
  @Column({ type: 'timestamptz', nullable: true })
  heldAgainToldAt!: Date | null;
}
