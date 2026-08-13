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

    try {
      await this.prisma.$transaction(async (tx) => {
        // Row-lock BOTH the container and the destination parent (when one
        // is given) with `SELECT ... FOR UPDATE`, in ascending-id order.
        // Locking in a deterministic order — regardless of which row is the
        // "container" and which is the "destination" from this call's point
        // of view — means two concurrent moveContainer calls that touch the
        // same two rows (e.g. A→B and, concurrently, B→A) always request
        // their locks in the same order, so the second call blocks until
        // the first commits/rolls back instead of deadlocking. Once
        // unblocked, the second call re-reads the POST-first-move state and
        // re-runs the cycle check against it — this is what closes the
        // TOCTOU window.
        //
        // `= ANY(ARRAY[...]::uuid[])`, not a bare `IN (...)` (EVT-30 round 3
        // regression, caught by the new locations.e2e-spec.ts DB-level test
        // against real Postgres — every unit test mocks `$queryRaw`, so this
        // was invisible there): an un-cast `IN (${Prisma.join(lockIds)})`
        // binds each id as `text`, and Postgres has no `uuid = text`
        // operator, so this raw query 500'd on every real "Move to…" request.
        // The explicit `::uuid[]` cast (same pattern as
        // `ItemsService.matchingItemHitsForTerms`'s `::text[]` cast) fixes it.
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

        // Lock the ENTIRE subtree rooted at the container BEFORE running the
        // ancestry (cycle) check below (EVT-30 round 3, security-reviewer
        // minor finding) — the id-based lock above only pins the
        // container's own row and the destination row; the raw path-rewrite
        // `UPDATE` further down touches every row currently inside the
        // subtree, none of which is otherwise locked. Without this, a row
        // moved INTO the subtree by a concurrent request, in the window
        // between the ancestry check and that `UPDATE`, could keep a stale
        // path. Closing the gap: a concurrent mover locks its OWN
        // destination row via this same `SELECT ... FOR UPDATE` idiom, so
        // if that destination is one of the rows locked here, it now blocks
        // until THIS transaction commits/rolls back. `ORDER BY id`, same
        // lock-order discipline as the lock above, so two overlapping
        // subtree locks block deterministically instead of deadlocking.
        const oldPath = freshContainer.path;
        await tx.$queryRaw`
          SELECT id
          FROM "Location"
          WHERE path = ${oldPath} OR path LIKE ${oldPath} || '.%'
          ORDER BY id
          FOR UPDATE
        `;

        let freshParent: { id: string; path: string } | null = null;
        if (toParentId) {
          const candidate = lockedById.get(toParentId);
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
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A location with the target path already exists`);
      }
      throw err;
    }

    return this.findOne(id);
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
