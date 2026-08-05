import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './create-category.dto';

export interface CategoryRow {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
}

/**
 * Converts a human-readable name into a URL/path-safe slug.
 * Rules (same as EVT-4 LocationsModule):
 *   - lowercase
 *   - any run of non-alphanumeric characters → single `-`
 *   - trim leading/trailing `-`
 *
 * Examples:
 *   "Hand Tools"            → "hand-tools"
 *   "West Wall / Cabinet #3" → "west-wall-cabinet-3"
 *   "18V Batteries & Chargers" → "18v-batteries-chargers"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Flat list of all categories ordered by materialized path. */
  async findAll(): Promise<CategoryRow[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { path: 'asc' },
      select: { id: true, name: true, path: true, parentId: true },
    });
    return rows.map((r) => ({ ...r, parentId: r.parentId }));
  }

  /**
   * Create a category.
   *
   * - `path` is composed as `<parentPath>.<slug>` (root: just `<slug>`).
   * - Duplicate sibling (identical path) is rejected with `ConflictException`.
   * - Unknown `parentId` is rejected with `NotFoundException`.
   */
  async create(dto: CreateCategoryDto): Promise<CategoryRow> {
    const slug = slugify(dto.name);

    // Guard: names composed entirely of non-alphanumeric characters (e.g., "!!!")
    // produce an empty slug, which would write path="" or "parent." to the DB —
    // silently corrupting the materialized-path structure.
    if (!slug) {
      throw new BadRequestException(
        `Category name "${dto.name}" produces an empty slug. Use alphanumeric characters.`,
      );
    }

    let path: string;
    const parentId: string | null = dto.parentId ?? null;

    if (parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) {
        throw new NotFoundException(`Parent category ${parentId} not found`);
      }
      path = `${parent.path}.${slug}`;
    } else {
      path = slug;
    }

    try {
      const created = await this.prisma.category.create({
        data: { name: dto.name, path, parentId },
        select: { id: true, name: true, path: true, parentId: true },
      });
      return { ...created, parentId: created.parentId };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `A category with path "${path}" already exists (duplicate sibling name)`,
        );
      }
      throw err;
    }
  }
}
