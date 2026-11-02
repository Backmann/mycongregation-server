import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * The stand's own few words for everyone who stands: a short memo of the
 * rules from whoever arranges it (2 November 2026). One row a congregation.
 */
@Entity('cart_settings')
export class CartSettings {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'text', nullable: true })
  memo!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
