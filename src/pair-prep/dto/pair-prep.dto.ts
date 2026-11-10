import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

/** The moment chosen, as the options list named it. */
export class ProposePairPrepDto {
  @IsString()
  @MaxLength(64)
  @Matches(
    /^(self|(after|before):\d{4}-\d{2}-\d{2}:(midweek|weekend)|service:[0-9a-f-]{36})$/,
  )
  key!: string;
}

export class AnswerPairPrepDto {
  @IsIn(['agree', 'decline'])
  answer!: 'agree' | 'decline';
}
