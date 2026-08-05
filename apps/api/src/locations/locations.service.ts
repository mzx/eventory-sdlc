import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  itemCount: number;
}

export interface LocationDetail {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  notes: string | null;
  qrCode: string;
  children: Array<{ id: string; name: string; path: string }>;
  items: Array<{
    id: string;
    name: string;
    primaryPhoto: { id: string; filename: string } | null;
  }>;
  breadcrumb: Array<{ segment: string; path: string }>;
}

export interface CreateLocationDto {
  name: string;
  parentId?: string;
  notes?: string;
}

export interface RenameLocationDto {
  name: string;
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Flat list ordered by materialized path. */
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
      itemCount: loc._count.items,
    }));
  }

  /** Single location with children, direct items, and breadcrumb. */
  async findOne(id: string): Promise<LocationDetail> {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: {
        children: { select: { id: true, name: true, path: true } },
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

    return this.prisma.$transaction(async (tx) => {
      // 1. Update the renamed location itself.
      const updated = await tx.location.update({
        where: { id },
        data: { name, path: newPath },
      });

      // 2. Rewrite all descendants: replace old prefix with new prefix.
      //    Uses raw SQL REPLACE() for a single atomic UPDATE.
      //    Template-literal parameters are escaped by Prisma — no injection risk.
      const oldPrefix = `${oldPath}.`;
      const newPrefix = `${newPath}.`;
      await tx.$executeRaw`
        UPDATE "Location"
        SET    path = replace(path, ${oldPrefix}, ${newPrefix})
        WHERE  path LIKE ${oldPrefix + '%'}
      `;

      return updated;
    });
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
