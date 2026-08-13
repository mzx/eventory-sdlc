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
 * Bounds `moveContainer`'s P2034 (serialization failure / deadlock) retry
 * loop — see that method's doc comment for why the retry exists. Matches
 * the retry bound `recordConsumption` uses in stock-movements.service.ts
 * (EVT-28), the established precedent in this codebase for a bounded
 * retry-on-transient-conflict loop.
 */
const MAX_MOVE_RETRIES = 5;

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
   * TOCTOU fix (EVT-30 review round 2, finding 1): a plain, non-locked read
   * of the ancestry outside the transaction is NOT sufficient — two
   * concurrent moves (`A.move({toParentId:B})` racing `B.move({toParentId:A})`)
   * can both read pre-move paths, both pass the cycle check, and both
   * commit, producing a parent cycle. The cycle check below is therefore
   * re-run INSIDE the transaction against rows read with
   * `SELECT ... FOR UPDATE` (see the transaction body for the locking
   * details) — the pre-transaction read above is only a fast-fail
   * convenience for the common "obviously invalid" cases (missing
   * location/parent, self-move, already-at-destination) so we don't open a
   * transaction for requests that can never succeed; it is never trusted for
   * the actual cycle decision.
   *
   * Single-statement subtree lock (EVT-30 round 4 — code + security
   * reviewers independently converged on the same MAJOR): round 3 acquired
   * the id-based container+destination lock and the whole-subtree lock as
   * TWO separate `SELECT ... FOR UPDATE` statements. `ORDER BY id` only
   * guarantees a deterministic acquisition order WITHIN a single statement
   * — across that two-statement pair, the *combined* acquisition order was
   * no longer globally consistent, because a concurrent mover could
   * interleave its own lock acquisition between them. Concretely: container
   * C has nested child container D; `A.move(C → X)` locks {C, X} in
   * statement 1, then goes to lock C's subtree (including D) in statement
   * 2; concurrently `B.move(D → X)` locks {D} first, then blocks on X (held
   * by A); A now blocks on D (held by B) — circular wait, and Postgres's
   * deadlock detector kills one side with error code P2034. Fixed by
   * folding BOTH lock targets into ONE `SELECT ... FOR UPDATE` statement —
   * `id = ANY(...) OR path = <old> OR path LIKE <old> || '.%'` — so the
   * whole union set (container + destination + entire subtree) is locked
   * in a single ascending-id sweep, restoring the deterministic global lock
   * order two concurrent movers rely on to avoid deadlocking. `<old>` here
   * is the container's path as read by the pre-transaction fast-fail lookup
   * above — it only seeds which rows this one statement locks; every
   * decision this method makes afterwards (the cycle check, the new path,
   * the descendant rewrite) always uses the FRESH, post-lock
   * `freshContainer.path` instead, never this pre-lock hint.
   *
   * P2034 resilience (EVT-30 round 4): even with correct lock ordering,
   * transient serialization conflicts between overlapping subtree locks
   * remain possible under concurrent load. Rather than let Prisma's P2034
   * surface as an unhandled 500, the whole transaction is retried up to
   * `MAX_MOVE_RETRIES` times (same bound `recordConsumption` uses in
   * stock-movements.service.ts, the established retry-on-transient-conflict
   * precedent in this codebase); a persistent failure after the retry
   * budget is exhausted maps to 409 Conflict.
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
    // no-op/cycle checks are re-run against locked reads inside the
    // transaction below, since this outer `location.parentId` read can be
    // stale by the time we'd act on it.
    if ((toParentId ?? null) === location.parentId) {
      return this.findOne(id);
    }

    // Bounded retry: a transaction that aborts with Prisma P2034 (Postgres
    // serialization failure / deadlock victim) is safe to retry outright —
    // it made no committed writes — see the doc comment above for why this
    // remains possible even with the single-statement lock below.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Single-statement lock over the UNION of (a) the container and
          // destination rows, by id, and (b) the container's entire
          // subtree, by path prefix — see the doc comment above for why
          // this MUST be one statement rather than two. `ORDER BY id`
          // makes the whole union set's acquisition order deterministic,
          // so two concurrent movers that touch overlapping rows always
          // request their locks in the same relative order and block
          // instead of deadlocking.
          //
          // `= ANY(ARRAY[...]::uuid[])`, not a bare `IN (...)` (EVT-30
          // round 3 regression, caught by the new locations.e2e-spec.ts
          // DB-level test against real Postgres — every unit test mocks
          // `$queryRaw`, so this was invisible there): an un-cast
          // `IN (${Prisma.join(lockIds)})` binds each id as `text`, and
          // Postgres has no `uuid = text` operator, so this raw query
          // 500'd on every real "Move to…" request. The explicit
          // `::uuid[]` cast (same pattern as
          // `ItemsService.matchingItemHitsForTerms`'s `::text[]` cast)
          // fixes it.
          const lockIds = Array.from(new Set(toParentId ? [id, toParentId] : [id])).sort();
          const lockedRows = await tx.$queryRaw<
            Array<{
              id: string;
              path: string;
              parentId: string | null;
              kind: LocationKind;
              name: string;
            }>
          >(Prisma.sql`
            SELECT id, path, "parentId", kind, name
            FROM "Location"
            WHERE id = ANY(ARRAY[${Prisma.join(lockIds)}]::uuid[])
               OR path = ${location.path}
               OR path LIKE ${location.path} || '.%'
            ORDER BY id
            FOR UPDATE
          `);
          const lockedById = new Map(lockedRows.map((row) => [row.id, row]));

          const freshContainer = lockedById.get(id);
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
            const candidate = lockedById.get(toParentId);
            if (!candidate) {
              throw new NotFoundException(`Location ${toParentId} not found`);
            }
            if (
              candidate.path === freshContainer.path ||
              candidate.path.startsWith(`${oldPath}.`)
            ) {
              throw new UnprocessableEntityException(
                `Cannot move "${freshContainer.name}" into itself or one of its own descendants`,
              );
            }
            freshParent = { id: candidate.id, path: candidate.path };
          }

          // Re-check the no-op condition against the LOCKED read — a
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
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
          if (attempt < MAX_MOVE_RETRIES - 1) {
            continue;
          }
          throw new ConflictException(
            `Could not move "${location.name}" right now — it conflicted with another move in progress. Please try again.`,
          );
        }
        throw err;
      }
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
