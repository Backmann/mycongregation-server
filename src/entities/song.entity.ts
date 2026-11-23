import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('songs')
@Index(['isActive'])
export class Song {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', unique: true })
  number!: number;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  /**
   * The song's length in seconds, from the official list of meeting
   * recordings (R-77, 22 November 2026); null — counted by the median.
   */
  @Column({ type: 'integer', name: 'duration_sec', nullable: true })
  durationSec!: number | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
