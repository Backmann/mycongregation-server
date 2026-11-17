import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FolderMarkState = 'saved' | 'separate' | 'paper' | 'na';

/**
 * How one item of the S-61 folder stands (17 November 2026).
 *
 * `itemKey` is the form's number ('1.3', '3.1'), and for the S-21 one file
 * per service group: '2.1:<group id>' or '2.1:none'. `stamp` is the
 * fingerprint of the item's data when its file was saved; when the data
 * changes later, the folder shows «изменилось — сохранить заново».
 */
@Entity('co_visit_folder_marks')
@Index('UQ_co_visit_folder_marks_item', ['specialEventId', 'itemKey'], {
  unique: true,
})
export class CoVisitFolderMark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  specialEventId!: string;

  @Column({ type: 'varchar', length: 60 })
  itemKey!: string;

  @Column({ type: 'varchar', length: 12 })
  state!: FolderMarkState;

  @Column({ type: 'varchar', length: 40, nullable: true })
  stamp!: string | null;

  @Column({ type: 'uuid', nullable: true })
  markedByUserId!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  markedAt!: Date;
}
