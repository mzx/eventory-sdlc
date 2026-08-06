import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '../db/db.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const dbMock = {
    ping: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DbService, useValue: dbMock }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns { status: "ok", db: true } when the DB ping succeeds', async () => {
    dbMock.ping.mockResolvedValue(undefined);

    const result = await controller.check();

    expect(result).toEqual({ status: 'ok', db: true });
    expect(dbMock.ping).toHaveBeenCalledTimes(1);
  });

  it('throws HttpException with 503 when the DB ping fails', async () => {
    dbMock.ping.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check()).rejects.toBeInstanceOf(HttpException);

    try {
      await controller.check();
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const body = (err as HttpException).getResponse() as Record<string, unknown>;
      expect(body.status).toBe('error');
      expect(body.db).toBe(false);
    }
  });
});
