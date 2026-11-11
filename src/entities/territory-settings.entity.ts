import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The territory section's state for one congregation (11 November 2026).
 *
 * Until the territory servant confirms the brought-over records
 * («Данные проверены»), the section is his alone: nobody is told about a
 * territory, the S-13 is not printed, and the import can be run again.
 */
@Entity('territory_settings')
export class TerritorySettings {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedByUserId!: string | null;

  /**
   * When the «Territory map» job last put the congregation's map file in
   * place (written by the job itself, on the server). Null: no streets yet.
   */
  @Column({ type: 'timestamptz', nullable: true })
  mapBuiltAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
