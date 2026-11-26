import { SentFieldsOnlyValidationPipe } from './sent-fields-only-validation.pipe';
import {
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PatchDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() time?: string;
  @IsOptional() @IsString() address?: string;
}

const meta = {
  type: 'body' as const,
  metatype: PatchDto,
  data: undefined,
};

describe('SentFieldsOnlyValidationPipe', () => {
  const pipe = new SentFieldsOnlyValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  // The journal claimed a special event's title, kind and dates had all been
  // emptied when only its time was edited. This is why.
  it('keeps only what the request actually sent', async () => {
    const out = (await pipe.transform({ time: '10:00' }, meta)) as object;
    expect(Object.keys(out)).toEqual(['time']);
  });

  it('so assigning it onto an entity leaves the rest alone', async () => {
    const dto = (await pipe.transform({ time: '10:00' }, meta)) as object;
    const entity = { title: 'Посещение', time: null, address: 'Hamm' };
    Object.assign(entity, dto);
    expect(entity).toEqual({
      title: 'Посещение',
      time: '10:00',
      address: 'Hamm',
    });
  });

  // Clearing a field is a real intention and must still travel.
  it('keeps an explicit null — that is a change, not an absence', async () => {
    const out = (await pipe.transform(
      { time: '10:00', address: null },
      meta,
    )) as Record<string, unknown>;
    expect(out.address).toBeNull();
    expect('address' in out).toBe(true);
  });
});

class Part {
  @IsBoolean() done!: boolean;
}
class FlagsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => Part)
  parts?: Part[];
}
const flags = { type: 'body' as const, metatype: FlagsDto, data: undefined };

describe('a yes/no in a JSON body (26 November 2026)', () => {
  const pipe = new SentFieldsOnlyValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const refusal = async (body: unknown, meta = flags) => {
    try {
      await pipe.transform(body, meta);
      return null;
    } catch (e) {
      return (e as { getResponse(): { fields: { field: string }[] } })
        .getResponse()
        .fields.map((f) => f.field);
    }
  };

  it('the text "false" is refused, not read as true', async () => {
    expect(await refusal({ enabled: 'false' })).toEqual(['enabled']);
    expect(await refusal({ enabled: 'true' })).toEqual(['enabled']);
    expect(await refusal({ enabled: 0 })).toEqual(['enabled']);
  });

  it('inside a list of nested ones too', async () => {
    expect(
      await refusal({ parts: [{ done: true }, { done: 'false' }] }),
    ).toEqual(['parts.1.done']);
  });

  it('a real yes/no, or none, passes as sent', async () => {
    expect(await refusal({ enabled: false })).toBeNull();
    expect(
      await refusal({ enabled: true, parts: [{ done: false }] }),
    ).toBeNull();
    expect(await refusal({})).toBeNull();
    const out = (await pipe.transform({ enabled: false }, flags)) as FlagsDto;
    expect(out.enabled).toBe(false);
  });

  it('the query string is not touched: there yes/no is text', async () => {
    expect(
      await refusal({ enabled: 'false' }, { ...flags, type: 'query' as never }),
    ).toBeNull();
  });
});
