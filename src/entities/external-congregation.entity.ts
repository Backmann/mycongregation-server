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

/**
 * Directory of OTHER congregations (not the tenant's own), maintained by the
 * public talk coordinator. Used to record where visiting speakers come from
 * and where our speakers travel to. Scoped per tenant via congregationId.
 * Reading is open to any authenticated member; writing is limited to admins
 * and the public_talk_coordinator — see the service.
 */
@Entity('external_congregations')
@Index(['congregationId', 'name'])
export class ExternalCongregation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Fields (congregation material, not personal — not encrypted) ----
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'text', nullable: true })
  contactName!: string | null;

  @Column({ type: 'text', nullable: true })
  contactPhone!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** Kingdom Hall address of the host congregation (for our outgoing speakers). */
  @Column({ type: 'text', nullable: true })
  address!: string | null;

  /** Weekend meeting day, ISO 1–7 (Mon–Sun). Other congregations meet on varying days. */
  @Column({ type: 'int', nullable: true })
  meetingDow!: number | null;

  /** Weekend meeting time, 'HH:mm'. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  meetingTime!: string | null;

  /** Optional map link (e.g. Google Maps) to the hall. */
  @Column({ type: 'text', nullable: true })
  mapUrl!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
