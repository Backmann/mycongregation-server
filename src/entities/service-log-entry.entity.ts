import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * ONE ENTRY OF A PIONEER'S OWN HOURS LOG (Lionel, 29 October 2026).
 *
 * Written by the person after he went out — a day and how long — and summed
 * into his report at the end of the month. His alone: no elder, overseer or
 * admin is ever given it; only the total reaches the report, and only when
 * he hands that in himself.
 *
 * The id is made on the phone, so an entry written without a connection and
 * sent twice is still one entry. It belongs to the sign-in AND the card
 * together: an account moved onto someone else's card does not carry its
 * entries into his view, nor his into it.
 *
 * Kept for the current and the previous service year, then deleted by the
 * night job. Nothing about it goes to the congregation's journal.
 */
export type ServiceLogKind = 'field' | 'credit';

@Entity('service_log_entries')
@Index(['congregationId', 'publisherId', 'day'])
export class ServiceLogEntry {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  publisherId!: string;

  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  /** The day served, by the congregation's calendar — «YYYY-MM-DD». */
  @Column({ type: 'date' })
  day!: string;

  @Column({ type: 'integer' })
  minutes!: number;

  /** «field» — the ministry; «credit» — hours credited (a construction, an assembly). */
  @Column({ type: 'varchar', length: 8, default: 'field' })
  kind!: ServiceLogKind;

  /** His own word for it; encrypted at rest like a report's note. */
  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  note!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
