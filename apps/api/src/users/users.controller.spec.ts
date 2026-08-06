import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const ADMIN = { id: 'admin-1', role: UserRole.admin, status: UserStatus.approved } as never;
const TARGET_ID = '11111111-1111-1111-1111-111111111111';

function makeServiceMock() {
  return {
    list: jest.fn(),
    updateStatus: jest.fn(),
    updateRole: jest.fn(),
  };
}

describe('UsersController', () => {
  let controller: UsersController;
  let service: ReturnType<typeof makeServiceMock>;

  beforeEach(async () => {
    service = makeServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('list', () => {
    it('delegates to UsersService.list', async () => {
      const rows = [{ id: 'u1' }];
      service.list.mockResolvedValue(rows);

      expect(await controller.list()).toBe(rows);
    });
  });

  describe('updateStatus', () => {
    it('delegates to UsersService.updateStatus with the acting admin', async () => {
      const dto = { status: UserStatus.approved };
      const updated = { id: TARGET_ID, status: UserStatus.approved };
      service.updateStatus.mockResolvedValue(updated);

      const result = await controller.updateStatus(TARGET_ID, dto, ADMIN);

      expect(service.updateStatus).toHaveBeenCalledWith(TARGET_ID, dto, ADMIN);
      expect(result).toBe(updated);
    });
  });

  describe('updateRole', () => {
    it('delegates to UsersService.updateRole with the acting admin', async () => {
      const dto = { role: UserRole.admin };
      const updated = { id: TARGET_ID, role: UserRole.admin };
      service.updateRole.mockResolvedValue(updated);

      const result = await controller.updateRole(TARGET_ID, dto, ADMIN);

      expect(service.updateRole).toHaveBeenCalledWith(TARGET_ID, dto, ADMIN);
      expect(result).toBe(updated);
    });
  });
});
