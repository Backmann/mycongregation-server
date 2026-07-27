import { SentFieldsOnlyValidationPipe } from './sent-fields-only-validation.pipe';
import { IsOptional, IsString } from 'class-validator';

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
