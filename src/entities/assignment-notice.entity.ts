import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * «Сказано»: one person has been told about one part or duty of theirs.
 *
 * Without it every reminder would have to guess whether it is the first word
 * about an assignment or a repeat — and a change applied «тихо» would later be
 * recalled to somebody who never heard of it. It also remembers what the item
 * was called and when it fell, so that its removal can be announced after the
 * item itself is gone.
 */
@Entity('assignment_notices')
@Index('uq_assignment_notices_user_item', ['userId', 'itemType', 'itemId'], {
  unique: true,
})
@Index('idx_assignment_notices_cong_date', ['congregationId', 'meetingDate'])
export class AssignmentNotice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 8 })
  itemType!: 'part' | 'duty';

  @Column({ type: 'uuid' })
  itemId!: string;

  @Column({ type: 'date' })
  meetingDate!: string;

  @Column({ type: 'varchar', length: 8 })
  meetingKind!: 'midweek' | 'weekend';

  @Column({ type: 'varchar', length: 64 })
  labelKey!: string;

  @Column({ type: 'text', nullable: true })
  labelTitle!: string | null;

  @Column({ type: 'boolean', default: false })
  assistant!: boolean;

  @Column({ type: 'integer', nullable: true })
  slot!: number | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  toldAt!: Date;
}
