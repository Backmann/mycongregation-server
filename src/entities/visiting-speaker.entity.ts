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
import { ExternalCongregation } from './external-congregation.entity';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * Directory of visiting (incoming) public speakers, maintained by the public
 * talk coordinator. Each speaker belongs to an external congregation and
 * carries a repertoire of public talk outline numbers he gives. Scoped per
 * tenant via congregationId. Reading is open to any authenticated member;
 * writing is limited to admins and the public_talk_coordinator — see service.
 */
@Entity('visiting_speakers')
@Index(['congregationId', 'lastName'])
export class VisitingSpeaker {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Identity (external person, congregation material — not encrypted) ----
  @Column({ type: 'text' })
  firstName!: string;

  @Column({ type: 'text', nullable: true })
  lastName!: string | null;

  // ---- Home congregation (from the external congregations directory) ----
  @Column({ type: 'uuid', nullable: true })
  @Index()
  externalCongregationId!: string | null;

  @ManyToOne(() => ExternalCongregation, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'external_congregation_id' })
  externalCongregation!: ExternalCongregation | null;

  // ---- Contact + notes (personal data — encrypted at rest) ----
  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  phone!: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  note!: string | null;

  // ---- Repertoire: public talk outline numbers he gives ----
  @Column({ type: 'int', array: true, default: () => "'{}'" })
  talkNumbers!: number[];

  /**
   * Карточку завело приложение, а не человек.
   *
   * Так помечается брат, впервые встреченный именем в программе: визит должен
   * попасть в его историю, значит карточка обязана существовать. У неё нет ни
   * телефона, ни репертуара — и это стоит показывать, чтобы координатор видел,
   * куда можно дописать сведения, а не думал, что справочник заполнен.
   */
  @Column({ type: 'boolean', default: false })
  autoCreated!: boolean;

  /**
   * Карточка объединена с другой — ссылка на оставшуюся.
   *
   * Не удаление: если через месяц окажется, что это были разные братья,
   * разъединять будет по чему. Пока ссылка стоит, карточка не показывается в
   * списках и не участвует в подсчётах — её визиты уже переехали.
   */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  mergedIntoId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
