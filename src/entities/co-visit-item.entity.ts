import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { SpecialEvent } from './special-event.entity';
import { CartLocation } from './cart-location.entity';
import { Publisher } from './publisher.entity';

/**
 * A single line in a circuit-overseer visit programme (Служение → График
 * районного). Deliberately flexible: one row type covers field-service
 * meetings, lunches, pastoral visits, pioneer/elders meetings and document
 * review, distinguished by `kind`, so new line types grow without a schema
 * migration. `forWife` separates the overseer's schedule from his wife's.
 */
@Entity('co_visit_items')
@Index(['congregationId', 'specialEventId'])
export class CoVisitItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  specialEventId!: string;

  @ManyToOne(() => SpecialEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'special_event_id' })
  specialEvent!: SpecialEvent;

  /** field_service | lunch | pastoral | pioneers | elders | document_review | other */
  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  /** false = overseer's schedule, true = his wife's schedule. */
  @Column({ type: 'boolean', default: false })
  forWife!: boolean;

  /** Marks the overseer's field-service day shared with his wife. */
  @Column({ type: 'boolean', default: false })
  withWife!: boolean;

  @Column({ type: 'date' })
  itemDate!: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  startTime!: string | null;

  /** kingdom_hall | cart_location | custom */
  @Column({ type: 'varchar', length: 20, nullable: true })
  placeKind!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cartLocationId!: string | null;

  @ManyToOne(() => CartLocation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'cart_location_id' })
  cartLocation!: CartLocation | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  placeText!: string | null;

  @Column({ type: 'uuid', nullable: true })
  assigneePublisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assignee_publisher_id' })
  assignee!: Publisher | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  assigneeText!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
