import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

// Use a class-based mock so `PrismaService extends PrismaClient` resolves
// correctly (returning a plain object from a mocked constructor would break
// the prototype chain and strip PrismaService's own methods).
//
// EVT-44: `PrismaService`'s constructor now also calls `$extends`/
// `$transaction`/`$executeRaw` to wire up RLS's `SET LOCAL` — `$extends`
// returns `this` (a no-op `Object.assign(this, this)`) so construction
// doesn't throw; the real RLS behavior is only meaningfully testable
// against real Postgres (see `test/rls-isolation.e2e-spec.ts`), not this
// unit-level lifecycle spec.
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
    $transaction = jest.fn();
    $executeRaw = jest.fn();
    $extends = jest.fn().mockImplementation(function (this: unknown) {
      return this;
    });
  }
  return { PrismaClient: MockPrismaClient };
});

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('calls $connect on onModuleInit', async () => {
    const spy = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('calls $disconnect on onModuleDestroy', async () => {
    const spy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
