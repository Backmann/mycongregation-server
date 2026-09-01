import { IsIn } from 'class-validator';

export class MovePlaceDto {
  /** Arrows, not dragging — see DutiesService.movePlace for why. */
  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}
