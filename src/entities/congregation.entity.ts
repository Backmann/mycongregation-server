import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('congregations')
export class Congregation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({
    type: 'varchar',
    length: 2,
    comment: 'ISO 3166-1 alpha-2 country code',
  })
  country!: string;

  @Column({
    type: 'varchar',
    length: 5,
    comment: 'IETF BCP 47 language tag (ru, de, en-US)',
  })
  language!: string;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: 'IANA timezone (Europe/Berlin)',
  })
  timezone!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
