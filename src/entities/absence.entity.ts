import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { Publisher } from './publisher.entity';

/**
 * Advisory publisher absences (vacation, travel, illness, …). Used to warn a
 * scheduler when they assign a publisher on a date that falls inside an
 * absence. Reading is open to any authenticated member; writing is limited to
 * the body_coordinator / life_ministry_overseer / secretary (admins always
 * pass) — see AbsencesController.
 */
@Entity('absences')
@Index(['publisherId', 'startDate'])
export class Absence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Subject ----
  @Column({ type: 'uuid' })
  @Index()
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;

  // ---- Period (single day when endDate is null) ----
  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  // ---- Detail (advisory, not encrypted) ----
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // Login (user id) that recorded this absence; for future self-service.
  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
