import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../common/enums/user-role.enum';

@Entity({ name: 'push_tokens' })
@Index(['userId', 'token'], { unique: true })
@Index(['congregationId', 'role'])
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: UserRole;

  @Column({ type: 'varchar', length: 255 })
  token!: string;

  @Column({ type: 'jsonb', nullable: true })
  deviceInfo!: Record<string, any> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
