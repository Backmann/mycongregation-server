import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { SpecialEvent } from './special-event.entity';
import { Publisher } from './publisher.entity';

/**
 * A single line of the Memorial programme.
 *
 * ONE row type covers everything on the sheet — the chairman, the prayers, the
 * talk, the brothers passing the emblems row by row, the attendants, the
 * parking — because those three groups differ only in `section`, and the shape
 * of a line is the same in all of them: a label, somebody assigned to it, and
 * a note. The same choice the circuit-visit programme made, for the same
 * reason: new kinds of line appear every year and none of them should need a
 * schema migration.
 *
 * WHY NOT the existing duties. Three things they cannot do and the Memorial
 * needs. The zones are named by the congregation — «Левый ряд», «Маленький
 * зал» — and depend on the hall, which may even be a rented room; a duty type
 * is an enum. Several people stand at one place: three at the parking, two per
 * row. And every line may carry a note the assignee must read before the
 * evening — «символы на стол в малом зале», «светоотражающие жилетки» — which
 * a duty has nowhere to keep.
 *
 * `label` is what the sheet says: «Молитва за хлеб», «Левый ряд», «Фойе». It
 * is free text on purpose. For the fixed programme parts the app fills it from
 * a template; for zones and duties the congregation types its own.
 *
 * `sortOrder` is the order on the sheet, moved by hand. The programme has a
 * fixed sequence — songs and prayers are not interchangeable — and zones read
 * left to right as the hall is laid out, which no automatic ordering knows.
 *
 * Removal is soft, as everywhere else a person's name is written down: a
 * mis-tap is undone from the journal rather than from last night's backup.
 */
@Entity('memorial_items')
@Index(['congregationId', 'specialEventId'])
export class MemorialItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  /** The Memorial itself — a special event of type `memorial`. */
  @Column({ type: 'uuid' })
  specialEventId!: string;

  @ManyToOne(() => SpecialEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'special_event_id' })
  specialEvent!: SpecialEvent;

  /**
   * Which part of the sheet this line belongs to:
   *   programme — chairman, songs, prayers, the talk, announcements
   *   emblems   — the brothers passing the emblems, one line per place
   *   duty      — attendants, microphone, sound, Zoom, parking
   *
   * Stored as a varchar rather than an enum so a fourth group can be added
   * without touching the schema.
   */
  @Column({ type: 'varchar', length: 20 })
  section!: string;

  /**
   * For programme lines only: which fixed part this is, so the app can put the
   * song picker on a song line and a brother picker on a prayer. Null for
   * zones and duties, whose meaning is carried entirely by the label.
   *
   * chairman | song_opening | prayer_opening | talk | prayer_bread |
   * prayer_wine | announcements | song_closing | prayer_closing
   */
  @Column({ type: 'varchar', length: 30, nullable: true })
  partKey!: string | null;

  /** What the sheet says: «Молитва за хлеб», «Левый ряд», «Стоянка». */
  @Column({ type: 'varchar', length: 255 })
  label!: string;

  /** Position on the sheet, moved by hand. */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid', nullable: true })
  publisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher | null;

  /**
   * A name written by hand, for a speaker from another congregation. Used only
   * when `publisherId` is null — the talk is usually given by one of our own,
   * but not always.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  personText!: string | null;

  /** The song number on a song line; null everywhere else. */
  @Column({ type: 'int', nullable: true })
  songNumber!: number | null;

  /**
   * What the assignee has to know before the evening: «символы на стол в
   * маленьком зале», «светоотражающие жилетки», «видеоприглашение на экранах».
   * These are on the sheet a congregation actually sends round, so they are
   * part of a line rather than a comment somewhere else.
   */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Index()
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
