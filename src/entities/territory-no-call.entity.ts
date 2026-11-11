import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * An address in a territory not to call at (11 November 2026).
 *
 * The branch allows the date and the address marked «do not call», and a
 * surname only where it is needed to find the flat (sfga, paragraph 24) — so
 * there is no field for a reason. Sealed at rest. Reviewed by the elders two
 * years on; one not kept is erased.
 */
@Entity('territory_no_calls')
@Index(['territoryId'])
export class TerritoryNoCall {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  territoryId!: string;

  @Column({ type: 'text', transformer: encryptedTransformer })
  address!: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  surname!: string | null;

  @Column({ type: 'date' })
  notedOn!: string;

  @Column({ type: 'date' })
  reviewOn!: string;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
