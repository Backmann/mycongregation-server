import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { Publisher } from './publisher.entity';

/**
 * A brother who may serve at the school — the list to choose from.
 *
 * Most of them come from OTHER congregations, so this cannot be the publisher
 * roster: those people have no card here and never will. The name is therefore
 * held on the row itself. When the brother IS one of ours, `publisherId` links
 * him, which is what lets the app notice that he is away that week or already
 * on a microphone at our own meeting.
 *
 * The list outlives one school: a school comes round every few years and the
 * same brothers help, and retyping twenty names is how a list stops being kept.
 */
@Entity('pioneer_school_helpers')
@Index(['congregationId', 'lastName'])
export class PioneerSchoolHelper {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 80 })
  firstName!: string;

  @Column({ type: 'varchar', length: 80 })
  lastName!: string;

  /** Where he comes from, when that is not us — printed after the name. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  congregationName!: string | null;

  /** Our own publisher, when he is one of ours. */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  publisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
