import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GrantAccessDto } from './grant-access.dto';

/**
 * The shape the screen actually sends.
 *
 * ValidationPipe runs with forbidNonWhitelisted, so a field the DTO does not
 * declare does not merely get dropped — the whole request is refused. That is
 * what «property loginName should not exist» was: pressing «Пригласить» did
 * nothing at all, because the server never looked past the shape.
 */
describe('GrantAccessDto accepts what the grant form sends', () => {
  const check = async (payload: Record<string, unknown>) => {
    const dto = plainToInstance(GrantAccessDto, payload);
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  };

  it('takes the whole payload of an invitation by letter', async () => {
    const errors = await check({
      email: 'family@gmail.com',
      loginName: 'Sidorova.Vera',
      sendInvite: true,
      isAdmin: false,
      saveEmailToCard: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('takes an invitation with no address at all', async () => {
    const errors = await check({
      loginName: 'sidorova.vera',
      sendInvite: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('lowercases and trims the name on the way in', async () => {
    const dto = plainToInstance(GrantAccessDto, {
      loginName: '  Sidorova.Vera ',
    });
    expect(dto.loginName).toBe('sidorova.vera');
  });
});
