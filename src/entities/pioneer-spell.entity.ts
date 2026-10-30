import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { Publisher } from './publisher.entity';
import { PioneerType } from '../common/enums/pioneer-type.enum';

/**
 * A period during which a publisher served as a PERMANENT pioneer — regular,
 * special, or missionary.
 *
 * Until now the card held two fields, `pioneerType` and `pioneerSince`, and
 * they answer only one question: what is he TODAY. A brother who pioneered from
 * 2019 to 2023 and stopped left no trace at all, so:
 *
 *   - filling his 2024 card offered «участвовал / не участвовал» with nowhere
 *     to write the hours he actually reported;
 *   - the monthly figures for a past month counted him as an ordinary
 *     publisher, because they asked the card rather than the month;
 *   - the pioneer year measured his goal from the wrong place.
 *
 * One row is one spell. `endMonth` null means he is serving still. Months are
 * first-of-month dates (YYYY-MM-01), as with auxiliary pioneers, so ranges
 * compare directly. Somebody who pioneered, stopped, and began again is simply
 * two rows — which the two card fields could never express.
 */
@Entity('pioneer_spells')
@Index(['congregationId', 'publisherId'])
@Index(['congregationId', 'startMonth'])
export class PioneerSpell {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;

  /** Which kind of pioneer he was during this spell. */
  @Column({ type: 'varchar', length: 32, name: 'pioneer_type' })
  pioneerType!: PioneerType;

  /** First month of the spell, YYYY-MM-01. */
  @Column({ type: 'date', name: 'start_month' })
  startMonth!: string;

  /** Last month (inclusive), or null while it is still running. */
  @Column({ type: 'date', name: 'end_month', nullable: true })
  endMonth!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /**
   * Instructions, point 9 (Lionel, 30 October 2026): the elders allow a
   * regular pioneer to serve without the hours requirement. The day of the
   * decision, as the S-21 notes it. It frees the whole service year it falls
   * in, and every year after while it stands.
   */
  @Column({ type: 'date', name: 'no_quota_decided_on', nullable: true })
  noQuotaDecidedOn!: string | null;

  /**
   * The day the decision was taken back. The service year it falls in stays
   * free; the requirement returns with the next one.
   */
  @Column({ type: 'date', name: 'no_quota_ended_on', nullable: true })
  noQuotaEndedOn!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
