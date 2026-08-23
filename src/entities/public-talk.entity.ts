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

  /**
   * The last day of a temporary restriction, or null when it is for good.
   *
   * Instructions sometimes set a talk aside for a period and it returns
   * afterwards. Marked as gone for ever, it would stay out of every list until
   * somebody remembered to restore it — the kind of remembering an
   * application exists to spare.
   */
  @Column({ type: 'date', name: 'retired_until', nullable: true })
  retiredUntil!: string | null;

  /**
   * Why — the announcement or letter this came from.
   *
   * «Речь 92 снята» answers nothing a year later; «Объявления и напоминания,
   * май 2026» answers it completely, and it is the sentence the coordinator
   * repeats to whoever asks.
   */
  @Column({
    type: 'varchar',
    length: 500,
    name: 'retired_reason',
    nullable: true,
  })
  retiredReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
