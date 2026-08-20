import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { defaultWorkspaceTagWhere } from '../workspace/default-workspace';

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
   * Upsert a single tag by name. Returns the existing record if already present.
   * Called by ItemsService (EVT-3) when creating/updating an item's tag list.
   *
   * `Tag.name` uniqueness was re-scoped to `@@unique([workspaceId, name])`
   * by EVT-39, so the lookup needs an explicit `workspaceId` to form the
   * compound key — see `defaultWorkspaceTagWhere`'s doc comment. `create`
   * itself doesn't need `workspaceId` spelled out — the column's schema
   * default fills it — but including it keeps the row the upsert reads and
   * the row it writes unambiguously the same one.
   */
  async upsertByName(name: string): Promise<{ id: string; name: string; color: string | null }> {
    return this.prisma.tag.upsert({
      where: await defaultWorkspaceTagWhere(this.prisma, name),
      update: {},
      create: { name },
    });
  }

  /**
   * Upsert multiple tags by name in parallel; returns an array of tag IDs in
   * the same order as the input names. Convenience wrapper for ItemsService.
   */
  async upsertMany(names: string[]): Promise<string[]> {
    const tags = await Promise.all(names.map((n) => this.upsertByName(n)));
    return tags.map((t) => t.id);
  }
}
