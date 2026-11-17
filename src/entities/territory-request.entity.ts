import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * «Попросить участок» (17 November 2026): a publisher asks the territory
 * servant for a personal territory («Организованы…», ch. 9 §32). One open
 * request a person. It closes when he is given a territory, when a keeper
 * answers «not now», or when he cancels; closed requests go after 30 days
 * (retention rule `territory-requests`).
 */
@Entity('territory_requests')
@Index('UQ_territory_requests_open', ['congregationId', 'publisherId'], {
  unique: true,
  where: '"closed_at" IS NULL',
})
export class TerritoryRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  publisherId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  /** given — a territory went to him; none — «not now»; cancelled — by him. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  closedHow!: 'given' | 'none' | 'cancelled' | null;

  @Column({ type: 'uuid', nullable: true })
  closedByUserId!: string | null;
}
