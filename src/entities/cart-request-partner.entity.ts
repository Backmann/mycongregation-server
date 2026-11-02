import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { CartRequest } from './cart-request.entity';
import { Publisher } from './publisher.entity';

/**
 * «С кем хотел бы» chosen from the list (2 November 2026): one or two cards
 * a wish names. A row of its own, not an array on the wish, so that both
 * ends are real foreign keys — merging two cards moves the link with them,
 * deleting a card takes it away — and nothing points at a card that is gone.
 * Read only by whoever arranges, like the written note beside it.
 */
@Entity('cart_request_partners')
export class CartRequestPartner {
  @PrimaryColumn({ type: 'uuid' })
  requestId!: string;

  @ManyToOne(() => CartRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: CartRequest;

  @PrimaryColumn({ type: 'uuid' })
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;
}
