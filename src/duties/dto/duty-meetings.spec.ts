import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GenerateWeekDutiesDto } from './generate-week-duties.dto';
import { CreateCustomDutyDto } from './create-custom-duty.dto';
import { QueryDutiesDto } from './query-duties.dto';
import { EventType } from '../../common/enums/event-type.enum';

/**
 * Every form that takes a kind of meeting must accept the same three.
 *
 * Three DTOs spelled `['midweek', 'weekend']` out by hand. Naming the Memorial
 * a third kind of meeting did not touch them, and nothing complained: they are
 * strings, so the type checker had nothing to object to and no test asked. The
 * first sign was the app refusing to create the Memorial's duties with
 * «eventType must be one of the following values: midweek, weekend» — after
 * the change had been deployed.
 *
 * The lists now come from one place. This is here so that the next form to be
 * added, or the next kind, cannot quietly disagree with the rest.
 */
async function errorsFor(dto: object): Promise<string[]> {
  const found = await validate(dto);
  return found.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('the forms that take a kind of meeting', () => {
  const cases: [string, (v: string) => object][] = [
    [
      'generateWeek',
      (v) =>
        plainToInstance(GenerateWeekDutiesDto, {
          weekStartDate: '2027-03-22',
          eventType: v,
        }),
    ],
    [
      'createCustom',
      (v) =>
        plainToInstance(CreateCustomDutyDto, {
          weekStartDate: '2027-03-22',
          eventType: v,
          customLabel: 'Стоянка',
        }),
    ],
    [
      'query',
      (v) =>
        plainToInstance(QueryDutiesDto, {
          weekStart: '2027-03-22',
          eventType: v,
        }),
    ],
  ];

  for (const [name, make] of cases) {
    it(`${name} accepts all three kinds`, async () => {
      for (const kind of [
        EventType.MIDWEEK,
        EventType.WEEKEND,
        EventType.MEMORIAL,
      ]) {
        expect(await errorsFor(make(kind))).toEqual([]);
      }
    });

    it(`${name} still refuses something that is not a meeting`, async () => {
      const errors = await errorsFor(make('cleaning'));
      expect(errors.join(' ')).toContain('eventType');
    });
  }
});
