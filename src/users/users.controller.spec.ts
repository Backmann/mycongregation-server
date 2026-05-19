import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRole } from '../common/enums/user-role.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const CONG = 'cong-1';
const ADMIN: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@cong.org',
  role: UserRole.ADMIN,
  congregationId: CONG,
  uiLanguage: 'ru',
};

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<Partial<UsersService>>;

  beforeEach(async () => {
    service = {
      findAllInCongregation: jest.fn().mockResolvedValue([]),
      createUserByAdmin: jest.fn().mockResolvedValue({ id: 'new-1' }),
      updateRoleByAdmin: jest.fn().mockResolvedValue({ id: 'u-1' }),
      setActiveByAdmin: jest.fn().mockResolvedValue({ id: 'u-1' }),
      resetPasswordByAdmin: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }, Reflector],
    })
      // Bypass RolesGuard in controller-level unit tests — guard logic is
      // covered separately in src/common/guards/roles.guard.spec.ts.
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('GET /users → service.findAllInCongregation', async () => {
    await controller.list(CONG);
    expect(service.findAllInCongregation).toHaveBeenCalledWith(CONG);
  });

  it('POST /users → service.createUserByAdmin with dto, tenant, admin id', async () => {
    const dto = {
      email: 'new@cong.org',
      password: 'verysecret',
      role: UserRole.PUBLISHER,
    };
    await controller.create(dto, CONG, ADMIN);
    expect(service.createUserByAdmin).toHaveBeenCalledWith(dto, CONG, ADMIN.id);
  });

  it('PATCH /users/:id/role → service.updateRoleByAdmin', async () => {
    await controller.updateRole('u-1', { role: UserRole.ELDER }, CONG, ADMIN);
    expect(service.updateRoleByAdmin).toHaveBeenCalledWith(
      'u-1',
      UserRole.ELDER,
      CONG,
      ADMIN.id,
    );
  });

  it('PATCH /users/:id/deactivate → service.setActiveByAdmin(id, false, ...)', async () => {
    await controller.deactivate('u-1', CONG, ADMIN);
    expect(service.setActiveByAdmin).toHaveBeenCalledWith(
      'u-1',
      false,
      CONG,
      ADMIN.id,
    );
  });

  it('PATCH /users/:id/activate → service.setActiveByAdmin(id, true, ...)', async () => {
    await controller.activate('u-1', CONG, ADMIN);
    expect(service.setActiveByAdmin).toHaveBeenCalledWith(
      'u-1',
      true,
      CONG,
      ADMIN.id,
    );
  });

  it('POST /users/:id/reset-password → service.resetPasswordByAdmin', async () => {
    await controller.resetPassword(
      'u-1',
      { password: 'newpass123' },
      CONG,
      ADMIN,
    );
    expect(service.resetPasswordByAdmin).toHaveBeenCalledWith(
      'u-1',
      'newpass123',
      CONG,
      ADMIN.id,
    );
  });
});
