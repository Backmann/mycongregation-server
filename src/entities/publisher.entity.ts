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
import { encryptedTransformer } from '../crypto/encrypted.transformer';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { Congregation } from './congregation.entity';
import { User } from './user.entity';
import { Family } from './family.entity';
import { ServiceGroup } from './service-group.entity';
import { Gender } from '../common/enums/gender.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { RemovalReason } from '../common/enums/removal-reason.enum';

@Entity('publishers')
@Index(['lastName', 'firstName'])
export class Publisher {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Optional 1:1 with auth User ----
  @Column({ type: 'uuid', nullable: true, unique: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  // ---- Family / Service group ----
  @Column({ type: 'uuid', nullable: true })
  @Index()
  familyId!: string | null;

  @ManyToOne(() => Family, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'family_id' })
  family!: Family | null;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  serviceGroupId!: string | null;

  @ManyToOne(() => ServiceGroup, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'service_group_id' })
  serviceGroup!: ServiceGroup | null;

  // ---- Personal ----
  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  middleName!: string | null;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 255 })
  displayName!: string;

  @Column({ type: 'enum', enum: Gender })
  gender!: Gender;

  @Column({ type: 'date', nullable: true })
  birthDate!: string | null;

  // ---- Contacts ----
  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  mobilePhone!: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  email!: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  address!: string | null;

  // ---- Status flags ----
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', default: true })
  isRegular!: boolean;

  @Column({ type: 'boolean', default: false })
  isFamilyHead!: boolean;

  // ---- Special needs (NW Scheduler "Другое") ----
  @Column({ type: 'boolean', default: false })
  isElderlyOrInfirm!: boolean;

  @Column({ type: 'boolean', default: false })
  isChild!: boolean;

  @Column({ type: 'boolean', default: false })
  isDeaf!: boolean;

  @Column({ type: 'boolean', default: false })
  isBlind!: boolean;

  @Column({ type: 'boolean', default: false })
  isPrisoner!: boolean;

  // ---- Spirituality ----
  @Column({
    type: 'enum',
    enum: PublisherAppointment,
    default: PublisherAppointment.PUBLISHER,
  })
  appointment!: PublisherAppointment;

  @Column({ type: 'date', nullable: true })
  baptismDate!: string | null;

  @Column({ type: 'date', nullable: true, comment: 'For unbaptized publishers' })
  ministryStartDate!: string | null;

  @Column({ type: 'enum', enum: PioneerType, default: PioneerType.NONE })
  pioneerType!: PioneerType;

  @Column({ type: 'date', nullable: true })
  pioneerSince!: string | null;

  @Column({ type: 'boolean', default: false })
  isAnointed!: boolean;

  @Column({ type: 'boolean', default: false })
  hasKingdomHallKey!: boolean;

  @Column({ type: 'boolean', default: false })
  printedWatchtower!: boolean;

  @Column({ type: 'boolean', default: false })
  printedWorkbook!: boolean;

  @Column({ type: 'boolean', default: false })
  sendsReportDirectly!: boolean;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  spiritualNotes!: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  notes!: string | null;

  // ---- Capabilities (what assignments this publisher can perform) ----
  @Column({ type: 'jsonb', default: {} })
  capabilities!: Record<string, boolean>;

  // ---- Removal lifecycle ----
  @Column({ type: 'enum', enum: RemovalReason, nullable: true })
  removalReason!: RemovalReason | null;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt!: Date | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  removedNote!: string | null;

  // ---- Status (computed from reports; manual override is sticky) ----
  @Column({
    type: 'varchar',
    length: 16,
    default: PublisherStatus.INACTIVE,
  })
  status!: PublisherStatus;

  @Column({
    type: 'boolean',
    name: 'status_manually_overridden',
    default: false,
  })
  statusManuallyOverridden!: boolean;

  @Column({
    type: 'uuid',
    name: 'status_overridden_by_id',
    nullable: true,
  })
  statusOverriddenById!: string | null;

  @Column({
    type: 'timestamptz',
    name: 'status_overridden_at',
    nullable: true,
  })
  statusOverriddenAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  restoredAt!: Date | null;

  // ---- Standard ----
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
