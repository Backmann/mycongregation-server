import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Layer 2 of the permission model: a department/coordinator assignment.
 * At most one holder per (congregation, type) — reassigning replaces the
 * previous holder. See docs/architecture/roles-and-permissions.md.
 *
 * userId / assignedBy are stored as plain uuid columns (no entity relation)
 * mirroring service-group.entity.ts, to avoid circular entity imports; FK
 * integrity is enforced at the database level by the migration.
 */
@Entity('responsibilities')
@Unique('uq_responsibilities_cong_type', ['congregationId', 'type'])
export class Responsibility {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 64 })
  type!: ResponsibilityType;

  /** The user (login account) who holds this responsibility. */
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  /** The admin who last assigned this responsibility. */
  @Column({ type: 'uuid', nullable: true })
  assignedBy!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  assignedAt!: Date;
}
