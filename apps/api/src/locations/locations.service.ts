import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LocationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RecordContainerMoveInput,
  StockMovementsService,
} from '../stock-movements/stock-movements.service';
import { CreateLocationDto } from './create-location.dto';

/**
 * Convert a human name into a URL/path-safe slug.
 * Rules: lowercase, collapse any run of non-alnum characters to a single `-`,
 * strip leading/trailing dashes.
 * Example: "West Wall / Cabinet #3" → "west-wall-cabinet-3"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface LocationListItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  qrCode: string;
  kind: LocationKind;
  /**
   * Recursive count: this location's own direct items PLUS every direct item
   * of every descendant location (EVT-30 AC 5) — computed in `findAll` from
   * the flat, path-ordered list rather than a per-node DB round trip.
   */
  itemCount: number;
}

export interface LocationDetail {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  notes: string | null;
  qrCode: string;
  kind: LocationKind;
  children: Array<{ id: string; name: string; path: string; kind: LocationKind }>;
  items: Array<{
    id: string;
    name: string;
    primaryPhoto: { id: string; filename: string } | null;
  }>;
  breadcrumb: Array<{ segment: string; path: string }>;
}

/**
 * Postgres advisory-lock key serializing ALL structural location-tree
 * mutations (`moveContainer` and `rename`, both of which rewrite a
 * subtree's materialized `path`).
 *
 * A single, transaction-scoped `pg_advisory_xact_lock(key)` — taken as the
 * FIRST statement inside each mutating transaction — is a simpler and
 * *stronger* guarantee than the row-locking machinery it replaces: no
 * concurrent structural mutation of ANY part of the tree can be in flight
 * while this lock is held, so plain (non-`FOR UPDATE`) reads taken after
 * acquiring it are safe to act on. The lock auto-releases at transaction
 * end (commit or rollback) — `pg_advisory_xact_lock`, not the
 * session-scoped `pg_advisory_lock`, so there is no leak/unlock
 * bookkeeping to reason about.
 *
 * Escalation path: if whole-tree serialization ever becomes a measured
 * throughput problem, narrow this to a per-tree-root key (e.g. a hash of
 * the root location's id) rather than reintroducing row-level locking —
 * see the class-level doc comment for the history of why row-locking was
 * abandoned.
 */
const LOCATION_TREE_LOCK_KEY = 7_030_001n;

/**
 * Locations service.
 *
 * ## Structural-mutation concurrency design (EVT-30 round 6)
 *
 * `moveContainer` and `rename` both rewrite a subtree's materialized `path`
 * column for a variable, data-dependent set of descendant rows. Rounds 3-5
 * iterated on row-level locking (`SELECT ... FOR UPDATE` over an
 * id-and-path-prefix union, eventually built as a single statement with
 * the subtree predicate derived in-statement via a CTE to avoid a
 * stale-path window) and were rejected in review each round — round 5's
 * design was ultimately EMPIRICALLY DISPROVEN: Postgres's EvalPlanQual
 * (EPQ) mechanism, which re-checks a `FOR UPDATE` row's visibility against
 * the newest committed version once a blocking concurrent writer commits
 * and releases, re-evaluates the row against the ORIGINAL query's
 * predicate rather than re-running the whole CTE-joined query against the
 * post-conflict tree. That let a descendant which had structurally moved
 * out of the intended lock set between snapshot and lock acquisition
 * still be treated as "locked" under EPQ's stale-snapshot replay — the
 * exact contention scenario the row-locking machinery existed to close.
 *
 * DECISION (operator, after three failed row-locking review rounds):
 * replace fine-grained row locking with a single Postgres
 * transaction-scoped advisory lock (`pg_advisory_xact_lock`, see
 * `LOCATION_TREE_LOCK_KEY` above) serializing ALL structural tree
 * mutations. Rationale: provable mutual exclusion with materially less
 * mechanism than any row-locking variant — no lock-ordering analysis, no
 * EPQ interaction to reason about, no CTE-snapshot staleness window — and
 * structural tree mutations (moving/renaming a container or area) are
 * human-paced in this application, so serializing them tree-wide costs
 * nothing observable while removing an entire class of concurrency bugs.
 * Escalation path if this ever needs to support concurrent structural
 * mutation: narrow the lock key per tree root (see
 * `LOCATION_TREE_LOCK_KEY`'s doc comment) — do not reach back for
 * row-level locking.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  /**
   * Flat list ordered by materialized path. `itemCount` is RECURSIVE (EVT-30
   * AC 5) — a container (or an area) rolls up the direct item count of every
   * descendant, not just its own direct items, computed in-memory from this
   * single flat fetch via path-prefix matching (O(n^2) over the location
   * count, which stays small at household/workshop scale — no separate
   * per-node query).
   */
  async findAll(): Promise<LocationListItem[]> {
    const locations = await this.prisma.location.findMany({
      orderBy: { path: 'asc' },
      include: {
        _count: { select: { items: true } },
      },
    });

    return locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      path: loc.path,
      parentId: loc.parentId,
      qrCode: loc.qrCode,
      kind: loc.kind,
      itemCount: recursiveItemCount(loc.path, locations),
    }));
  }

  /** Single location with children, direct items, and breadcrumb. */
  async findOne(id: string): Promise<LocationDetail> {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: {
        children: { select: { id: true, name: true, path: true, kind: true } },
        items: {
          select: {
            id: true,
            name: true,
            primaryPhoto: { select: { id: true, filename: true } },
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException(`Location ${id} not found`);
    }

    // Build breadcrumb purely from path segments (no extra DB round-trip).
    const segments = location.path.split('.');
    const breadcrumb = segments.map((segment, i) => ({
      segment,
      path: segments.slice(0, i + 1).join('.'),
    }));

    return {
      id: location.id,
      name: location.name,
      path: location.path,
      parentId: location.parentId,
      notes: location.notes,
      qrCode: location.qrCode,
      kind: location.kind,
      children: location.children,
      items: location.items,
      breadcrumb,
    };
  }

  /** Resolve a location by its QR token. */
  async findByQr(qr: string) {
    const location = await this.prisma.location.findUnique({
      where: { qrCode: qr },
    });

    if (!location) {
      throw new NotFoundException(`Location with QR "${qr}" not found`);
    }

    return location;
  }

  /**
   * Create a location.
   * - If `parentId` is supplied the new location is nested under that parent;
   *   its path is `parent.path + '.' + slug`.
   * - Root locations have no parent; path equals the slug.
   * - Duplicate sibling slugs (i.e. duplicate paths) are rejected with 409.
   */
  async create(dto: CreateLocationDto) {
    const slug = slugify(dto.name);

    let path: string;
    if (dto.parentId) {
      const parent = await this.prisma.location.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(`Parent location ${dto.parentId} not found`);
      }
      path = `${parent.path}.${slug}`;
    } else {
      path = slug;
    }

    try {
      return await this.prisma.location.create({
        data: {
          name: dto.name,
          path,
          parentId: dto.parentId ?? null,
          notes: dto.notes ?? null,
          kind: dto.kind ?? 'area',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `A sibling location with slug "${slug}" already exists at this level (path "${path}" is taken)`,
        );
      }
      throw err;
    }
  }

  /**
   * Rename a location.
   * Recomputes its own path and atomically rewrites all descendant paths inside
   * a single transaction so the tree is never partially updated.
   *
   * Rename also rewrites subtree paths — same class of structural mutation
   * as `moveContainer` — so it takes the SAME `LOCATION_TREE_LOCK_KEY`
   * advisory lock, as the FIRST statement of its own transaction, before
   * any read this method relies on for its decision (the pre-flight
   * `findUnique`/`findFirst` above are fast-fail convenience only, exactly
   * like `moveContainer`'s pre-transaction reads — see that method's doc
   * comment). See the class-level doc comment for the full design
   * rationale.
   */
  async rename(id: string, name: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) {
      throw new NotFoundException(`Location ${id} not found`);
    }

    const slug = slugify(name);
    const oldPath = location.path;
    const segments = oldPath.split('.');
    segments[segments.length - 1] = slug;
    const newPath = segments.join('.');

    // Nothing to do.
    if (newPath === oldPath && name === location.name) {
      return location;
    }

    // Conflict check: another location already owns the new path.
    if (newPath !== oldPath) {
      const conflict = await this.prisma.location.findFirst({
        where: { path: newPath, id: { not: id } },
      });
      if (conflict) {
        throw new ConflictException(`A location with path "${newPath}" already exists`);
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Advisory lock FIRST — see LOCATION_TREE_LOCK_KEY's doc comment.
        // Serializes this rename against every other structural mutation
        // (moves and renames alike) tree-wide. `$executeRaw`, not
        // `$queryRaw`: `pg_advisory_xact_lock` returns `void`, and Prisma's
        // `$queryRaw` result-row deserializer cannot handle a `void`-typed
        // column (throws P2010 "Failed to deserialize column of type
        // 'void'" on every call — verified against real Postgres).
        // `$executeRaw` only reports the affected-row count, which we don't
        // need here anyway, and has no such deserialization step.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCATION_TREE_LOCK_KEY})`;

        // 1. Update the renamed location itself.
        const updated = await tx.location.update({
          where: { id },
          data: { name, path: newPath },
        });

        // 2. Rewrite all descendants: replace the leading old-prefix with the
        //    new-prefix using a SUBSTRING-based expression so that only the
        //    leading path segment is rewritten.  Using SQL REPLACE() here would
        //    corrupt paths where the same slug appears more than once
        //    (e.g. renaming "a" → "b" would turn descendant "a.a.child" into
        //    "b.b.child" instead of "b.a.child").
        //    Template-literal parameters are escaped by Prisma — no injection risk.
        const oldPrefix = `${oldPath}.`;
        const newPrefix = `${newPath}.`;
        await tx.$executeRaw`
          UPDATE "Location"
          SET    path = ${newPrefix} || SUBSTRING(path FROM LENGTH(${oldPrefix}) + 1)
          WHERE  path LIKE ${oldPrefix + '%'}
        `;

        return updated;
      });
    } catch (err) {
      // Guard against the TOCTOU window: two concurrent rename requests can both
      // pass the pre-flight findFirst check, then the second hits the DB @unique
      // constraint inside the transaction.  Map that to a 409 instead of 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A location with path "${newPath}" already exists`);
      }
      // Defensive: with the advisory lock enforcing mutual exclusion across
      // ALL structural mutations, a genuine Postgres serialization failure
      // (P2034) or transaction-conflict (P2010-shaped) error here is
      // unreachable in practice — nothing else can be concurrently mutating
      // the tree while this transaction holds LOCATION_TREE_LOCK_KEY. Map it
      // to 409 anyway rather than letting it surface as an unhandled 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2034' || err.code === 'P2010')
      ) {
        throw new ConflictException(`A location with path "${newPath}" already exists`);
      }
      throw err;
    }
  }

  /**
   * "Move to…" — re-parents a CONTAINER location under `toParentId` (or to
   * root when `null`), rewriting its own path and every descendant's path in
   * the same atomic transaction as `rename` (EVT-30 AC 2). All contents —
   * items placed directly in the container or any of its descendant
   * containers — implicitly follow, since they're addressed by
   * `locationId`/materialized path, not copied.
   *
   * Restricted to `kind: 'container'` — `area` nodes keep the existing
   * add/rename/delete management flows (EVT-30 non-goal); moving an area
   * throws 400.
   *
   * Guard rails (EVT-30 AC 4, risk register): rejects moving a container
   * into itself or any of its own descendants with 422.
   *
   * Concurrency design (EVT-30 round 6 — see the class-level doc comment
   * for the full history of why the earlier row-locking rounds 3-5 were
   * abandoned): the FIRST statement inside the transaction below takes
   * `pg_advisory_xact_lock(LOCATION_TREE_LOCK_KEY)`. Because that lock
   * serializes this transaction against every other structural tree
   * mutation (every other in-flight `moveContainer` or `rename`), no
   * concurrent writer can be modifying the container, the destination, or
   * any part of the subtree while this transaction holds the lock — so the
   * plain `findUnique`/`findFirst` reads taken AFTER acquiring it are safe
   * to act on directly, with no `FOR UPDATE`, no lock-ordering analysis,
   * and no CTE-snapshot staleness window to reason about. The outer,
   * pre-transaction reads below remain fast-fail convenience only (missing
   * location/parent, self-move, already-at-destination) so we don't open a
   * transaction for requests that can never succeed; the transaction's own
   * post-lock reads are what the actual decision is based on.
   *
   * Records exactly ONE itemless `move` `StockMovement` for the container
   * itself (EVT-30 AC 3) — never one row per contained item.
   */
  async moveContainer(
    id: string,
    toParentId: string | null,
    createdById?: string,
  ): Promise<LocationDetail> {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) {
      throw new NotFoundException(`Location ${id} not found`);
    }
    if (location.kind !== 'container') {
      throw new BadRequestException(
        `Only container locations can be moved; "${location.name}" is an area. Area locations keep the existing add/rename/delete flows.`,
      );
    }
    if (toParentId === id) {
      throw new UnprocessableEntityException(`Cannot move "${location.name}" into itself`);
    }

    if (toParentId) {
      const parentExists = await this.prisma.location.findUnique({
        where: { id: toParentId },
        select: { id: true },
      });
      if (!parentExists) {
        throw new NotFoundException(`Location ${toParentId} not found`);
      }
    }

    // Already at the requested destination — fast-path no-op that skips
    // opening a transaction. This is only a convenience short-circuit for
    // the common case; it is NOT relied on for correctness — the real
    // no-op check is re-run against a post-lock read inside the transaction
    // below, since this outer `location.parentId` read can be stale by the
    // time we'd act on it.
    if ((toParentId ?? null) === location.parentId) {
      return this.findOne(id);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Advisory lock FIRST — see the method's doc comment and
        // LOCATION_TREE_LOCK_KEY's doc comment. Everything after this line
        // executes with exclusive ownership of ALL structural tree
        // mutation; the reads below are plain (no `FOR UPDATE`) because
        // this lock is what makes them safe to act on. `$executeRaw`, not
        // `$queryRaw` — see `rename`'s identical lock statement for why
        // (`pg_advisory_xact_lock` returns `void`, which `$queryRaw`'s
        // result-row deserializer cannot handle).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCATION_TREE_LOCK_KEY})`;

        const freshContainer = await tx.location.findUnique({ where: { id } });
        if (!freshContainer) {
          throw new NotFoundException(`Location ${id} not found`);
        }
        if (freshContainer.kind !== 'container') {
          throw new BadRequestException(
            `Only container locations can be moved; "${freshContainer.name}" is an area. Area locations keep the existing add/rename/delete flows.`,
          );
        }

        const oldPath = freshContainer.path;

        let freshParent: { id: string; path: string } | null = null;
        if (toParentId) {
          const candidate = await tx.location.findUnique({
            where: { id: toParentId },
            select: { id: true, path: true },
          });
          if (!candidate) {
            throw new NotFoundException(`Location ${toParentId} not found`);
          }
          if (candidate.path === freshContainer.path || candidate.path.startsWith(`${oldPath}.`)) {
            throw new UnprocessableEntityException(
              `Cannot move "${freshContainer.name}" into itself or one of its own descendants`,
            );
          }
          freshParent = { id: candidate.id, path: candidate.path };
        }

        // Re-check the no-op condition against the post-lock read — a
        // concurrent move could have already landed the container at this
        // exact destination between the outer fast-path check and
        // acquiring the lock here.
        if ((toParentId ?? null) === freshContainer.parentId) {
          return;
        }

        const leafSlug = oldPath.split('.').pop() as string;
        const newPath = freshParent ? `${freshParent.path}.${leafSlug}` : leafSlug;

        if (newPath !== oldPath) {
          const conflict = await tx.location.findFirst({
            where: { path: newPath, id: { not: id } },
          });
          if (conflict) {
            throw new ConflictException(`A location with path "${newPath}" already exists`);
          }
        }

        const fromLocationId = freshContainer.parentId;

        await tx.location.update({
          where: { id },
          data: { parentId: toParentId, path: newPath },
        });

        // Same SUBSTRING-based prefix rewrite as `rename` — see that
        // method's doc comment for why REPLACE() would corrupt paths where
        // the same slug repeats at multiple depths.
        if (newPath !== oldPath) {
          const oldPrefix = `${oldPath}.`;
          const newPrefix = `${newPath}.`;
          await tx.$executeRaw`
            UPDATE "Location"
            SET    path = ${newPrefix} || SUBSTRING(path FROM LENGTH(${oldPrefix}) + 1)
            WHERE  path LIKE ${oldPrefix + '%'}
          `;
        }

        const input: RecordContainerMoveInput = {
          containerId: id,
          fromLocationId,
          toLocationId: toParentId,
          createdById,
          // Denormalize the container's name into `note` (EVT-30 review
          // round 2, finding 4) — `StockMovement.container` now uses
          // `onDelete: SetNull` rather than `Cascade` (the audit trail must
          // survive the container being deleted later), so once
          // `containerId` is nulled out this is the only remaining
          // human-readable trace of which container this row was about.
          note: `Container "${freshContainer.name}" moved`,
        };
        await this.stockMovementsService.recordContainerMove(tx, input);
      });

      return this.findOne(id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A location with the target path already exists`);
      }
      // Defensive: with the advisory lock enforcing mutual exclusion across
      // ALL structural mutations, a genuine Postgres serialization failure
      // (P2034) or transaction-conflict (P2010-shaped) error here is
      // unreachable in practice — nothing else can be concurrently mutating
      // the tree while this transaction holds LOCATION_TREE_LOCK_KEY. Map
      // it to 409 anyway rather than letting it surface as an unhandled 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2034' || err.code === 'P2010')
      ) {
        throw new ConflictException(
          `Could not move "${location.name}" right now — it conflicted with another move in progress. Please try again.`,
        );
      }
      throw err;
    }
  }

  /**
   * Delete a location.
   * Rejected if the location has any direct children (to prevent orphaned
   * sub-trees).  Items inside the location receive `locationId = null` via the
   * schema's `onDelete: SetNull`.
   */
  async remove(id: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) {
      throw new NotFoundException(`Location ${id} not found`);
    }

    const childCount = await this.prisma.location.count({
      where: { parentId: id },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        `Cannot delete location "${location.name}" because it still has ${childCount} child location(s). Delete or move the children first.`,
      );
    }

    return this.prisma.location.delete({ where: { id } });
  }
}

/**
 * Sums `_count.items` across `loc` itself and every descendant of `loc`
 * (path equal to `loc.path`, or starting with `"${loc.path}."`) within the
 * already-fetched flat `locations` list — see `findAll`'s doc comment.
 */
function recursiveItemCount(
  path: string,
  locations: Array<{ path: string; _count: { items: number } }>,
): number {
  const prefix = `${path}.`;
  return locations.reduce((sum, other) => {
    if (other.path === path || other.path.startsWith(prefix)) {
      return sum + other._count.items;
    }
    return sum;
  }, 0);
}
