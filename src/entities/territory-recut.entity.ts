import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The measure of a territory the draft is made by (15 November 2026): how
 * long a walk a territory may be, in the city and far out, and how far out
 * «far» begins. Walks in km of streets along the homes plus the ways
 * between them; «far» by minutes of driving from the nearest hall.
 */
/** One territory's figures, as last worked out for the draft. */
export interface RecutMetric {
  number: string;
  homes: number;
  /** The walk: streets along its homes plus the roads between them, km. */
  walkKm: number;
  /** Minutes by car from the nearest hall to its middle; null: no road. */
  driveMinutes: number | null;
  /** Which hall is nearest: its index in `halls`. */
  hall: number | null;
}

export interface RecutMetrics {
  /** The halls as found on the map; null where the address was not found. */
  halls: { name: string; found: boolean }[];
  territories: Record<string, RecutMetric>;
}

export interface RecutMeasure {
  cityMaxKm: number;
  cityTargetKm: number;
  remoteMaxKm: number;
  remoteTargetKm: number;
  minKm: number;
  remoteMinutes: number;
}

/**
 * The draft of re-cutting the territories: one per congregation. See
 * migration TerritoryRecut.
 */
@Entity('territory_recuts')
export class TerritoryRecut {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_territory_recuts_congregation', { unique: true })
  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'jsonb' })
  measure!: RecutMeasure;

  /** The keepers' word over the drive time: territory id → city or far. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  classes!: Record<string, 'city' | 'far'>;

  @Column({ type: 'jsonb', nullable: true })
  metrics!: RecutMetrics | null;

  @Column({ type: 'timestamptz', nullable: true })
  metricsAt!: Date | null;

  /**
   * The walk (km) of each part of the open proposals, by the border of the
   * part (borderPrint); null — it could not be worked out. Worked out in the
   * background; a key no part has any more is dropped.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  walks!: Record<string, number | null>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

export type RecutKind = 'cut' | 'merge';

/**
 * One proposal of the draft: cut a territory along lines into parts, or
 * join neighbours. It changes nothing until it is applied.
 */
@Entity('territory_recut_proposals')
@Index('IDX_territory_recut_proposals_recut', ['recutId'])
export class TerritoryRecutProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  recutId!: string;

  @Column({ type: 'varchar', length: 8 })
  kind!: RecutKind;

  /** A cut: the one territory; a join: the territories joined. */
  @Column({ type: 'uuid', array: true })
  territoryIds!: string[];

  /** Each territory's border fingerprint as it was drawn: a later move is seen. */
  @Column({ type: 'jsonb' })
  base!: Record<string, string>;

  /** A cut: the lines across it, [lon, lat] points each. */
  @Column({ type: 'jsonb', nullable: true })
  lines!: [number, number][][] | null;

  /**
   * A cut: the lines it was first proposed with — to go back to, and to
   * show a line moved by hand. Null for a cut drawn by hand.
   */
  @Column({ type: 'jsonb', nullable: true })
  suggestedLines!: [number, number][][] | null;

  /** A cut: which part keeps the number and the S-13 history. */
  @Column({ type: 'smallint', default: 0 })
  keep!: number;

  /** A cut: the numbers of the other parts, in their order. */
  @Column({ type: 'jsonb', nullable: true })
  numbers!: string[] | null;

  /** A join: the territory whose number stays. */
  @Column({ type: 'uuid', nullable: true })
  keepId!: string | null;

  /** 1, 2, 3: which round it belongs to. */
  @Column({ type: 'smallint', default: 1 })
  queue!: number;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  state!: 'open' | 'applied';

  /** The service committee's decision; null while it is discussed. */
  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  /**
   * When the parts last changed by more than a tenth of the homes (or in
   * number): «no remarks» given before it was about other lines.
   */
  @Column({ type: 'timestamptz', nullable: true })
  linesChangedAt!: Date | null;

  /** Changed much after a decision: back to the committee. */
  @Column({ type: 'timestamptz', nullable: true })
  reopenedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * «No remarks», or a remark about a proposal's border, by one of those who
 * look at the draft. Deleted with the proposal and when it is applied.
 */
@Entity('territory_recut_remarks')
@Index('UQ_territory_recut_remarks_person', ['proposalId', 'userId'], {
  unique: true,
})
export class TerritoryRecutRemark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  proposalId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'boolean' })
  ok!: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  text!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
