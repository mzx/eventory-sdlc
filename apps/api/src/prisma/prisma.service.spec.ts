import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { RLS_WORKSPACE_SETTING, workspaceDbContext } from '../workspace/workspace-context';
import { PrismaService, RLS_SCOPED_MODELS } from './prisma.service';

// ---------------------------------------------------------------------------
// Mock @prisma/client
// ---------------------------------------------------------------------------
//
// EVT-44 round-2 review (MAJOR, finding 5): the previous version of this
// file only tested $connect/$disconnect, while the `!**/prisma.service.ts`
// coverage exclusion hid ~190 lines of security-critical RLS dispatch logic
// (the `$transaction` override, the model-delegate Proxy) from the 80%
// coverage gate entirely. That exclusion is now removed (jest.config.js);
// this file instead unit-tests the DISPATCH/BRANCH logic directly, against
// a mock Prisma client whose `$transaction`/`$executeRaw`/model-delegate
// methods are plain `jest.fn()`s — the actual DATABASE semantics (does
// Postgres really enforce the resulting `set_config`) are proven separately,
// against real Postgres, by `test/rls-isolation.e2e-spec.ts`.
//
// The mock's `$connect`/`$disconnect`/`$transaction`/`$executeRaw`/`item`/
// `user` fields are all assigned from variables captured in THIS factory's
// closure (not fresh literals per instance) — this lets test code below
// grab the SAME underlying `jest.fn()`s that `PrismaService`'s real
// constructor captured (via `this.$transaction.bind(this)` etc., BEFORE
// the RLS Proxy wraps `this`) by constructing a second, throwaway
// `MockPrismaClient` instance purely to read its fields off — see
// `rawMocks` below.
jest.mock('@prisma/client', () => {
  const $connect = jest.fn().mockResolvedValue(undefined);
  const $disconnect = jest.fn().mockResolvedValue(undefined);
  const $transaction = jest.fn();
  const $executeRaw = jest.fn();
  const $extends = jest.fn().mockImplementation(function (this: unknown) {
    return this;
  });
  // `item` is in RLS_SCOPED_MODELS (mirrors the EVT-44 migration's table
  // list); `user` deliberately is NOT (User is never workspace-scoped) —
  // exercising both is what proves the Proxy's allowlist actually
  // discriminates rather than wrapping everything.
  const item = { findMany: jest.fn(), someNonFunctionProp: 'static-value' };
  const user = { findMany: jest.fn() };

  class MockPrismaClient {
    $connect = $connect;
    $disconnect = $disconnect;
    $transaction = $transaction;
    $executeRaw = $executeRaw;
    $extends = $extends;
    item = item;
    user = user;
  }
  return { PrismaClient: MockPrismaClient };
});

// ---------------------------------------------------------------------------
// Shared mock handles
// ---------------------------------------------------------------------------

interface RawMocks {
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
  item: { findMany: jest.Mock; someNonFunctionProp: string };
  user: { findMany: jest.Mock };
}

/**
 * A second, throwaway `MockPrismaClient` instance, constructed purely to
 * read its fields — which are the SAME shared `jest.fn()`s the mocked
 * `@prisma/client` module's factory closed over (see the `jest.mock` call
 * above), and therefore the SAME ones `PrismaService`'s real constructor
 * captured as `rawTransaction`/`rawExecuteRaw` before wrapping `this` in
 * its RLS Proxy.
 */
const rawMocks = new (PrismaClient as unknown as new () => RawMocks)();

/**
 * `PrismaService`'s `$transaction` OVERRIDE calls THIS (the raw, pre-Proxy
 * `$transaction`) either directly (passthrough) or with a wrapper function/
 * array — this generic implementation models Prisma's real two shapes
 * closely enough for dispatch-logic testing:
 *   - a `function` arg is INVOKED with a fake `tx` (mirrors Prisma's
 *     interactive-transaction form, `$transaction(async (tx) => {...})`).
 *   - an `array` arg is resolved via `Promise.all` (mirrors Prisma's
 *     sequential form, `$transaction([p1, p2])`).
 */
function installGenericTransactionMock(): void {
  rawMocks.$transaction.mockImplementation((arg: unknown) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    const fakeTx = { $executeRaw: rawMocks.$executeRaw, item: rawMocks.item, user: rawMocks.user };
    return (arg as (tx: unknown) => unknown)(fakeTx);
  });
}

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PrismaService', () => {
  let service: PrismaService;
  let warnSpy: jest.SpyInstance;
  const originalAppDatabaseUrl = process.env.APP_DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    jest.clearAllMocks();
    installGenericTransactionMock();
    // A non-empty value here keeps the shared `service` below from
    // triggering the finding-6 fallback warning in every OTHER test in this
    // file — that behavior gets its own dedicated `describe` block further
    // down, which manages this env var explicitly per test.
    process.env.APP_DATABASE_URL =
      'postgresql://eventory_rls:x@localhost:5432/eventory?schema=public';
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalAppDatabaseUrl === undefined) {
      delete process.env.APP_DATABASE_URL;
    } else {
      process.env.APP_DATABASE_URL = originalAppDatabaseUrl;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
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

  // =========================================================================
  // RLS_SCOPED_MODELS — the explicit allowlist itself
  // =========================================================================

  describe('RLS_SCOPED_MODELS', () => {
    it('contains exactly the eight EVT-44 migration tables (lowerCamelCase)', () => {
      expect([...RLS_SCOPED_MODELS].sort()).toEqual(
        [
          'item',
          'location',
          'category',
          'tag',
          'photo',
          'project',
          'stockMovement',
          'shoppingListEntry',
        ].sort(),
      );
    });

    it('does NOT include user/workspace/workspaceMember/workspaceInvite', () => {
      expect(RLS_SCOPED_MODELS.has('user')).toBe(false);
      expect(RLS_SCOPED_MODELS.has('workspace')).toBe(false);
      expect(RLS_SCOPED_MODELS.has('workspaceMember')).toBe(false);
      expect(RLS_SCOPED_MODELS.has('workspaceInvite')).toBe(false);
    });
  });

  // =========================================================================
  // $transaction override
  // =========================================================================

  describe('$transaction override', () => {
    it('with an ambient workspace + a function arg: injects set_config as the FIRST statement, then runs the callback under insideManagedTransaction: true', async () => {
      let observedStoreInsideCallback: unknown;
      const userCallback = jest.fn(async (tx: unknown) => {
        observedStoreInsideCallback = workspaceDbContext.getStore();
        expect(tx).toBeDefined();
        return 'callback-result';
      });

      const result = await workspaceDbContext.run({ workspaceId: WORKSPACE_ID }, () =>
        service.$transaction(userCallback),
      );

      expect(result).toBe('callback-result');
      expect(userCallback).toHaveBeenCalledTimes(1);
      expect(observedStoreInsideCallback).toEqual({
        workspaceId: WORKSPACE_ID,
        insideManagedTransaction: true,
      });

      // rawTransaction was called with a NEW wrapper function, not the
      // original callback reference directly.
      expect(rawMocks.$transaction).toHaveBeenCalledTimes(1);
      expect(rawMocks.$transaction.mock.calls[0][0]).not.toBe(userCallback);
      expect(typeof rawMocks.$transaction.mock.calls[0][0]).toBe('function');

      // set_config was the first (and only) $executeRaw call, keyed to
      // RLS_WORKSPACE_SETTING ('app.workspace_id') and the ambient value.
      expect(rawMocks.$executeRaw).toHaveBeenCalledTimes(1);
      const setConfigArgs = rawMocks.$executeRaw.mock.calls[0];
      // Only TWO bound values — `RLS_WORKSPACE_SETTING` and `workspaceId`.
      // The trailing `true` in `set_config(..., true)` is literal SQL text
      // (the `SET LOCAL` / transaction-scoped flag), not a THIRD
      // interpolated template value.
      expect(setConfigArgs[1]).toBe(RLS_WORKSPACE_SETTING);
      expect(setConfigArgs[2]).toBe(WORKSPACE_ID);
      expect(setConfigArgs).toHaveLength(3);
      expect(setConfigArgs[0].join('')).toContain('true');
    });

    it('without an ambient workspace: passes the EXACT original function/options through to the raw $transaction, unwrapped', async () => {
      const plainCallback = jest.fn(async () => 'plain-result');
      const options = { maxWait: 5000 };

      const result = await service.$transaction(plainCallback, options);

      expect(result).toBe('plain-result');
      expect(rawMocks.$transaction).toHaveBeenCalledTimes(1);
      // The EXACT same references, not a wrapper — proves no wrapping
      // happened at all, not just that behavior looks similar.
      expect(rawMocks.$transaction).toHaveBeenCalledWith(plainCallback, options);
      expect(rawMocks.$executeRaw).not.toHaveBeenCalled();
    });

    it('with a non-function (sequential array) arg: bypasses the workspace-wrapping branch entirely, even WITH an ambient workspace present', async () => {
      const arrayArg = [Promise.resolve(1), Promise.resolve(2)];

      const result = await workspaceDbContext.run({ workspaceId: WORKSPACE_ID }, () =>
        // `arrayArg` deliberately isn't a real `PrismaPromise[]` — this test
        // is about the DISPATCH branch (function vs. non-function), not
        // Prisma's sequential-transaction typing.
        service.$transaction(arrayArg as never),
      );

      expect(result).toEqual([1, 2]);
      expect(rawMocks.$transaction).toHaveBeenCalledWith(arrayArg, undefined);
      expect(rawMocks.$executeRaw).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Proxy dispatch — standalone calls on RLS-scoped vs. non-scoped model
  // delegates
  // =========================================================================

  describe('Proxy dispatch (standalone, non-$transaction calls)', () => {
    it('RLS-scoped model + ambient workspace + NOT inside a managed transaction: wraps in a sequential $transaction([setConfig, query]) and unwraps the query result', async () => {
      rawMocks.item.findMany.mockResolvedValue('item-result');

      const result = await workspaceDbContext.run({ workspaceId: WORKSPACE_ID }, () =>
        service.item.findMany({ where: { id: 'x' } }),
      );

      expect(result).toBe('item-result');
      expect(rawMocks.item.findMany).toHaveBeenCalledWith({ where: { id: 'x' } });

      expect(rawMocks.$executeRaw).toHaveBeenCalledTimes(1);
      const setConfigArgs = rawMocks.$executeRaw.mock.calls[0];
      // Only TWO bound values — `RLS_WORKSPACE_SETTING` and `workspaceId`.
      // The trailing `true` in `set_config(..., true)` is literal SQL text
      // (the `SET LOCAL` / transaction-scoped flag), not a THIRD
      // interpolated template value.
      expect(setConfigArgs[1]).toBe(RLS_WORKSPACE_SETTING);
      expect(setConfigArgs[2]).toBe(WORKSPACE_ID);
      expect(setConfigArgs).toHaveLength(3);
      expect(setConfigArgs[0].join('')).toContain('true');

      expect(rawMocks.$transaction).toHaveBeenCalledTimes(1);
      expect(Array.isArray(rawMocks.$transaction.mock.calls[0][0])).toBe(true);
    });

    it('RLS-scoped model + NO ambient workspace: runs unwrapped — no $transaction, no set_config', async () => {
      rawMocks.item.findMany.mockResolvedValue('item-result-unscoped');

      const result = await service.item.findMany({ where: { id: 'y' } });

      expect(result).toBe('item-result-unscoped');
      expect(rawMocks.item.findMany).toHaveBeenCalledWith({ where: { id: 'y' } });
      expect(rawMocks.$transaction).not.toHaveBeenCalled();
      expect(rawMocks.$executeRaw).not.toHaveBeenCalled();
    });

    it('RLS-scoped model + ambient workspace + insideManagedTransaction: true: still runs unwrapped (skip-branch — never double-wraps a nested tx.model.op() call)', async () => {
      rawMocks.item.findMany.mockResolvedValue('nested-result');

      const result = await workspaceDbContext.run(
        { workspaceId: WORKSPACE_ID, insideManagedTransaction: true },
        () => service.item.findMany(),
      );

      expect(result).toBe('nested-result');
      expect(rawMocks.$transaction).not.toHaveBeenCalled();
      expect(rawMocks.$executeRaw).not.toHaveBeenCalled();
    });

    it('a non-RLS-scoped model (user) is forwarded straight through via Reflect.get, never wrapped — even with an ambient workspace present', async () => {
      rawMocks.user.findMany.mockResolvedValue('user-result');

      const result = await workspaceDbContext.run({ workspaceId: WORKSPACE_ID }, () =>
        service.user.findMany(),
      );

      expect(result).toBe('user-result');
      expect(rawMocks.$transaction).not.toHaveBeenCalled();
      expect(rawMocks.$executeRaw).not.toHaveBeenCalled();
    });

    it('a non-function property on a scoped model delegate is returned as-is, not wrapped as a callable', () => {
      const itemDelegate = service.item as unknown as { someNonFunctionProp: string };
      expect(itemDelegate.someNonFunctionProp).toBe('static-value');
    });

    it('a non-model, non-$-prefixed property access on the service itself forwards straight through Reflect.get', () => {
      // `RLS_SCOPED_MODELS` doesn't include an arbitrary prop like this —
      // confirms the outer Proxy's allowlist check, not just the inner one.
      expect((service as unknown as { doesNotExist?: unknown }).doesNotExist).toBeUndefined();
    });
  });

  // =========================================================================
  // APP_DATABASE_URL fallback (round-2 review, SHOULD FIX finding 6)
  // =========================================================================

  describe('APP_DATABASE_URL fallback warning', () => {
    it('logs a startup warning when APP_DATABASE_URL is unset (falls back to DATABASE_URL)', () => {
      delete process.env.APP_DATABASE_URL;
      process.env.NODE_ENV = 'test';
      warnSpy.mockClear();

      // eslint-disable-next-line no-new
      new PrismaService();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('APP_DATABASE_URL is not set');
    });

    it('does NOT warn when APP_DATABASE_URL is set', () => {
      process.env.APP_DATABASE_URL = 'postgresql://eventory_rls:x@localhost:5432/eventory';
      warnSpy.mockClear();

      // eslint-disable-next-line no-new
      new PrismaService();

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('throws (fails hard) instead of warning when NODE_ENV=production and APP_DATABASE_URL is unset', () => {
      delete process.env.APP_DATABASE_URL;
      process.env.NODE_ENV = 'production';

      expect(() => new PrismaService()).toThrow(/APP_DATABASE_URL/);
    });
  });
});
