import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TagWithCount {
  id: string;
  name: string;
  color: string | null;
  /** Number of items currently tagged with this tag. */
  itemCount: number;
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All tags ordered by item count desc, then name asc.
   * Used by GET /api/tags for autocomplete / filter UI.
   */
  async findAll(): Promise<TagWithCount[]> {
    const tags = await this.prisma.tag.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: [{ items: { _count: 'desc' } }, { name: 'asc' }],
    });
    return tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      itemCount: t._count.items,
    }));
  }

  /**
   * Upsert a single tag by name, scoped to `workspaceId`. Returns the
   * existing record if already present. Called by ItemsService (EVT-3) when
   * creating/updating an item's tag list.
   *
   * `Tag.name` uniqueness was re-scoped to `@@unique([workspaceId, name])`
   * by EVT-39, so the lookup needs an explicit `workspaceId` to form the
   * compound key. `workspaceId` is now the caller's ACTIVE tenant context
   * (EVT-40) rather than always the Default Workspace — every tag this
   * upserts belongs to the same workspace as the item it's being attached
   * to, per `ItemsService.create`/`.update`.
   */
  async upsertByName(
    name: string,
    workspaceId: string,
  ): Promise<{ id: string; name: string; color: string | null }> {
    return this.prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      update: {},
      create: { name, workspaceId },
    });
  }

  /**
   * Upsert multiple tags by name in parallel, scoped to `workspaceId`;
   * returns an array of tag IDs in the same order as the input names.
   * Convenience wrapper for ItemsService.
   */
  async upsertMany(names: string[], workspaceId: string): Promise<string[]> {
    const tags = await Promise.all(names.map((n) => this.upsertByName(n, workspaceId)));
    return tags.map((t) => t.id);
  }
}
