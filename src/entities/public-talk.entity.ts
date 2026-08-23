import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('public_talks')
@Index(['isActive'])
export class PublicTalk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', unique: true })
  number!: number;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /**
   * The date from which this talk is no longer to be given.
   *
   * Null for a talk in use, and also for one retired by hand before this
   * column existed — «снята», with no date to show. The instruction that
   * arrives always carries one: «начиная с 1 сентября 2026 года».
   */
  @Column({ type: 'date', name: 'retired_from', nullable: true })
  retiredFrom!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
