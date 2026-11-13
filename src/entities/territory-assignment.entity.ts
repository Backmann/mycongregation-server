import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TerritoryMethod = 'door_to_door' | 'letters' | 'campaign' | 'other';
export const TERRITORY_METHODS: TerritoryMethod[] = [
  'door_to_door',
  'letters',
  'campaign',
  'other',
];

/**
 * One time a territory was given out (11 November 2026) — a line of the S-13.
 *
 * It is held by one person. «For the group» marks a territory the group works
 * together; the S-13 then reads «Гр. 2 · surname».
 *
 * `holderName` is the name as it stood when the territory was given, and the
 * S-13 is printed from it rather than from the card: a holder may move away,
 * and a removed card is anonymised in time, while the S-13 must keep its
 * names for the current and the previous service year.
 *
 * It ends one of two ways: worked (`completedOn`, with the method) or handed
 * back unworked (`returnedOn`), which leaves the S-13's «worked» date empty.
 * At most one is open per territory (a partial unique index).
 */
@Entity('territory_assignments')
@Index(['congregationId'])
@Index(['territoryId'])
export class TerritoryAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  territoryId!: string;

  /** The card, while there is one; null for a holder who has left. */
  @Column({ type: 'uuid', nullable: true })
  publisherId!: string | null;

  @Column({ type: 'varchar', length: 160 })
  holderName!: string;

  /** The service group it was given for, if it is the group's territory. */
  @Column({ type: 'uuid', nullable: true })
  forGroupId!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  forGroupName!: string | null;

  @Column({ type: 'date' })
  assignedOn!: string;

  @Column({ type: 'date', nullable: true })
  dueOn!: string | null;

  @Column({ type: 'date', nullable: true })
  completedOn!: string | null;

  @Column({ type: 'date', nullable: true })
  returnedOn!: string | null;

  @Column({ type: 'varchar', length: 14, nullable: true })
  method!: TerritoryMethod | null;

  /** The holder has used his one extension of a month. */
  @Column({ type: 'boolean', default: false })
  extended!: boolean;

  /** Brought over from earlier records rather than given out here. */
  @Column({ type: 'boolean', default: false })
  imported!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  /**
   * The hash of the link without login to this assignment's map; the link
   * itself is shown once and never stored. Null: no link.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  linkHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  linkCreatedAt!: Date | null;

  /** Waiting for its paper map to be printed (13 November 2026). */
  @Column({ type: 'timestamptz', nullable: true })
  paperWantedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
