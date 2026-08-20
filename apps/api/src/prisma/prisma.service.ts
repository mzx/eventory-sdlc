import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RLS_WORKSPACE_SETTING, workspaceDbContext } from '../workspace/workspace-context';

/** Any Prisma model delegate's operation method (`findMany`, `create`, ...). */
type ModelOperation = (...args: unknown[]) => unknown;

/**
 * Module-scoped (not an instance field) so it's usable BEFORE `super()` is
 * called inside `PrismaService`'s constructor (the `APP_DATABASE_URL`
 * fallback warning below, round-2 review finding 6, needs to fire before
 * the `PrismaClient` base constructor even runs) — a derived class
 * constructor cannot reference `this` (and therefore no instance field)
 * until `super()` has been invoked.
 */
const logger = new Logger('PrismaService');

/**
 * The Prisma Client property names (lowerCamelCase model names) the EVT-44
 * `PrismaService` Proxy auto-wraps for standalone (non-`$transaction`)
 * calls — see that Proxy's doc comment inside the constructor for why this
 * is an explicit allowlist. Mirrors EXACTLY the table list the EVT-44
 * migration puts `ENABLE`/`FORCE ROW LEVEL SECURITY` + a policy on.
 *
 * Exported (round-2 review, finding 8) so the RLS e2e self-maintenance
 * check (`test/rls-isolation.e2e-spec.ts`) can cross-reference this list
 * against `information_schema` (every table with its own `workspaceId`
 * column) and `pg_policies` (every table that actually has a policy) — a
 * future workspace-scoped table can't silently ship without ALL THREE
 * staying in sync.
 */
export const RLS_SCOPED_MODELS = new Set([
  'item',
  'location',
  'category',
  'tag',
  'photo',
  'project',
  'stockMovement',
  'shoppingListEntry',
]);

/**
 * Thin NestJS wrapper around PrismaClient — and, as of EVT-44, the piece
 * that drives Postgres row-level security's `app.workspace_id` session
 * setting for every query this connection runs.
 *
 * Connects using `APP_DATABASE_URL` (falling back to `DATABASE_URL` when
 * unset, so any environment that hasn't configured the split — e.g. the
 * OTHER `*.e2e-spec.ts` files in this repo, which don't exercise RLS —
 * behaves exactly as before EVT-44). `APP_DATABASE_URL` is expected to be
 * the deliberately unprivileged `eventory_rls` role the EVT-44 migration
 * creates; `DATABASE_URL` stays the migration/owner role, since DDL
 * (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, future
 * migrations) needs privileges `eventory_rls` deliberately does NOT have.
 * See docs/operations/tenancy-rls.md for the full layered-security writeup.
 *
 * RLS enforcement in Postgres is transaction-scoped: `SET LOCAL`/
 * `set_config(..., true)` only affects statements within the SAME
 * transaction, resetting at COMMIT/ROLLBACK. Since Prisma's connection pool
 * reuses physical connections across unrelated requests, a session-level
 * `SET` (not `SET LOCAL`) would leak one request's workspace into another's
 * queries on the same pooled connection — the exact risk this task's
 * "Risk" note calls out. This class closes that gap two ways, both driven
 * by `workspaceDbContext` (`AsyncLocalStorage`, populated by
 * `WorkspaceDbContextInterceptor` — see `workspace-context.ts` and that
 * interceptor's doc comment for why it's an interceptor, not this guard):
 *
 * 1. `$transaction` itself is overridden so every EXISTING interactive
 *    transaction call site in this codebase (`this.prisma.$transaction(async
 *    (tx) => {...})` — the advisory-lock paths in `LocationsService`, the
 *    BOM backflush in `ProjectsService`, etc.) transparently gets
 *    `set_config('app.workspace_id', ...)` injected as its FIRST statement,
 *    with ZERO changes to any of those call sites.
 * 2. A Proxy wraps each RLS-scoped model delegate (`this.item`,
 *    `this.location`, ... — see `RLS_SCOPED_MODELS` below, deliberately an
 *    explicit allowlist matching the EVT-44 migration's table list) so a
 *    STANDALONE (non-transaction) call — e.g. a plain
 *    `this.prisma.item.findMany()` — is transparently rewritten into a
 *    two-statement SEQUENTIAL `$transaction([setConfig, query])`, which
 *    Postgres runs as a single `BEGIN; ...; COMMIT` on one connection (the
 *    same technique the official Prisma RLS guide uses —
 *    https://www.prisma.io/docs/orm/prisma-client/queries/row-level-security
 *    — just applied via a hand-rolled Proxy rather than `$extends`; see the
 *    "why not $extends" note below).
 *
 * Both paths check an `insideManagedTransaction` ALS flag (set only by (1),
 * for the duration of the wrapped callback) so a nested `tx.model.op()`
 * call inside an interactive transaction is never re-wrapped in a second,
 * unrelated transaction — Prisma doesn't support nesting `$transaction`
 * calls, and attempting it would silently run the nested SET LOCAL on a
 * DIFFERENT connection than the one the surrounding transaction (and its
 * advisory lock / backflush writes) actually holds.
 *
 * **Why a hand-rolled Proxy instead of `$extends`'s `query` component**
 * (which is Prisma's own documented mechanism for exactly this): verified
 * empirically (not just by inspection) against real Postgres that a
 * `$allModels.$allOperations` query-extension hook does NOT reliably see
 * `workspaceDbContext.getStore()` — Prisma Client defers a model
 * operation's actual dispatch (and the invocation of `query`-component
 * hooks) through internal machinery that does not preserve the CALLER's
 * `AsyncLocalStorage` context, so the hook consistently observed
 * `getStore() === undefined` even when the call site was synchronously
 * inside `workspaceDbContext.run(...)`. A `Proxy` intercepting the model
 * delegate's method call directly captures the ALS store SYNCHRONOUSLY, in
 * the same call frame as the application code that invoked it (exactly
 * like the `$transaction` override above, which has no such issue because
 * it's a plain, directly-invoked method override, not a Prisma-internal
 * hook) — see `test/rls-isolation.e2e-spec.ts`'s AC2/AC3 tests, which is
 * what caught the `$extends` version silently running every "auto-wrapped"
 * query completely unscoped.
 *
 * When no `workspaceId` is present in `workspaceDbContext` at all (no
 * `@Public()`/admin-bootstrap request ever entered one), queries run
 * UNWRAPPED — no `set_config` call is made. Since the EVT-44 migration sets
 * `FORCE ROW LEVEL SECURITY` and `eventory_rls` has no bypass privilege,
 * this fails CLOSED (zero rows / rejected writes) rather than silently
 * running unscoped — see the migration's own doc comment and AC1's e2e
 * proof (`test/rls-isolation.e2e-spec.ts`).
 *
 * Declared `@Global()` via PrismaModule so any feature module can inject it
 * without importing PrismaModule explicitly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const appDatabaseUrl = process.env.APP_DATABASE_URL;
    if (!appDatabaseUrl) {
      // Falling back to DATABASE_URL means the runtime connection is the
      // migration OWNER role (a superuser in this project's docker-compose
      // setups) — RLS becomes a structural no-op for every query on this
      // connection, silently, since a superuser always bypasses `FORCE ROW
      // LEVEL SECURITY` (round-2 review, finding 6). This is INTENTIONAL for
      // the many `*.e2e-spec.ts` files that don't exercise RLS at all (see
      // this class's own doc comment), so it can't be a hard error
      // unconditionally — but it must never be silent, and it must never
      // happen in production.
      const message =
        'PrismaService: APP_DATABASE_URL is not set — falling back to DATABASE_URL ' +
        '(the migration OWNER role). Postgres row-level security (EVT-44) becomes a ' +
        'structural no-op for this connection: a superuser/owner role bypasses ' +
        'FORCE ROW LEVEL SECURITY entirely, regardless of app.workspace_id. See ' +
        'apps/api/.env.example and docs/operations/tenancy-rls.md.';
      if (process.env.NODE_ENV === 'production') {
        // Fail hard rather than silently running with zero RLS containment
        // in the one environment where that matters most.
        throw new Error(`${message} Refusing to start with NODE_ENV=production.`);
      }
      logger.warn(message);
    }

    super({
      datasources: {
        db: { url: appDatabaseUrl ?? process.env.DATABASE_URL },
      },
    });

    // Captured on the UNPROXIED instance — the Proxy returned at the bottom
    // of this constructor wraps model delegates only; `$transaction`/
    // `$executeRaw` are passed straight through it, so binding to `this`
    // here (before the Proxy exists) vs. after makes no behavioral
    // difference, but doing it first keeps the two helpers unambiguous
    // going forward.
    const rawTransaction = this.$transaction.bind(this);
    const rawExecuteRaw = this.$executeRaw.bind(this);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$transaction = (arg: unknown, options?: unknown) => {
      const store = workspaceDbContext.getStore();
      if (typeof arg !== 'function' || !store?.workspaceId) {
        return rawTransaction(arg as never, options as never);
      }
      const workspaceId = store.workspaceId;
      return rawTransaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config(${RLS_WORKSPACE_SETTING}, ${workspaceId}, true)`;
        return workspaceDbContext.run({ workspaceId, insideManagedTransaction: true }, () =>
          (arg as (tx: unknown) => unknown)(tx),
        );
      }, options as never);
    };

    // NestJS's DI container holds onto whatever THIS constructor returns as
    // the ONE `PrismaService` instance for the app's whole lifetime,
    // injected by class reference everywhere (`private readonly prisma:
    // PrismaService`) — returning a `Proxy` wrapping `this` (rather than
    // `this` itself) is a standard, supported JS pattern (a class
    // constructor may `return` a different object) and is transparent to
    // both `instanceof PrismaService` checks and every existing
    // `this.prisma.item.*` call site, which keeps working completely
    // unchanged while gaining the interception below.
    //
    // ONLY the property names below are wrapped — deliberately an explicit
    // allowlist, not "any object-shaped property", for two reasons: (1) it
    // mirrors exactly the table list the EVT-44 migration puts RLS policies
    // on (`WorkspaceMember`/`WorkspaceInvite`/`Workspace`/`User` are
    // INTENTIONALLY excluded — see the migration's doc comment — so
    // wrapping them here would be dead weight at best), and (2) a broader
    // "wrap every non-`$`-prefixed object property" heuristic was tried
    // first and empirically corrupted `jest.spyOn(prismaService,
    // '$connect')` in this file's own spec (the Proxy's `get` trap
    // re-derived a FRESH bound function on every access, which stripped
    // the jest mock's own methods off whatever `jest.spyOn` had just
    // installed) — an explicit allowlist sidesteps that class of surprise
    // entirely for every property this Proxy doesn't specifically care
    // about, which just forward straight to `Reflect.get`.
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop !== 'string' || !RLS_SCOPED_MODELS.has(prop)) {
          return Reflect.get(target, prop, receiver);
        }
        // A workspace-scoped model delegate (`this.item`, `this.location`,
        // ...) — wrap each of ITS methods (`findMany`, `create`, ...)
        // individually.
        const value = Reflect.get(target, prop, receiver) as object;
        return new Proxy(value, {
          get(modelTarget, modelProp, modelReceiver) {
            const modelValue = Reflect.get(modelTarget, modelProp, modelReceiver);
            if (typeof modelValue !== 'function') {
              return modelValue;
            }
            const operation = modelValue as ModelOperation;
            return (...args: unknown[]) => {
              const store = workspaceDbContext.getStore();
              if (!store?.workspaceId || store.insideManagedTransaction) {
                return operation.apply(modelTarget, args);
              }
              const workspaceId = store.workspaceId;
              return rawTransaction([
                rawExecuteRaw`SELECT set_config(${RLS_WORKSPACE_SETTING}, ${workspaceId}, true)`,
                operation.apply(modelTarget, args) as never,
              ] as never).then((results: unknown[]) => results[1]);
            };
          },
        });
      },
    }) as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
