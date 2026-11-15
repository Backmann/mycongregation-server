import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The keepers' word on a building (15 November 2026): a home or not, over
 * the rule. About the building only — no note, nothing about people. Where
 * the building's middle was, and the cadastre's id of it when known: each
 * map build finds it again (home_marks_found, migration HomeMarks). Read
 * and written through SQL (territories/home-marks.service.ts).
 */
@Entity('map_home_marks')
@Index('IDX_map_home_marks_congregation', ['congregationId'])
export class MapHomeMark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  officialId!: string | null;

  @Column({ type: 'double precision' })
  lon!: number;

  @Column({ type: 'double precision' })
  lat!: number;

  @Column({ type: 'boolean' })
  home!: boolean;

  /** Who marked it, for the journal; null once that account is gone. */
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
