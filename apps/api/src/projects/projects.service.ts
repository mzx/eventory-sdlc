import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { BackflushDto } from './backflush.dto';
import { CreateBomLineDto } from './create-bom-line.dto';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsQueryDto } from './list-projects-query.dto';
import { UpdateBomLineDto } from './update-bom-line.dto';
import { UpdateProjectDto } from './update-project.dto';

// ---------------------------------------------------------------------------
// Shared Prisma include shapes
// ---------------------------------------------------------------------------

/** Summary of a linked item, embedded on BOM lines. */
const LINKED_ITEM_SELECT = { id: true, name: true, qrCode: true };

/**
 * Full detail: BOM lines (incl. linked item summary), oldest line first, plus
 * the backflush consumption history (EVT-28) — every `build` movement linked
 * to this project, newest first. `stockMovements` is renamed to `consumed`
 * in `findOne`'s/`backflush`'s response shape (see below).
 */
const PROJECT_DETAIL_INCLUDE = {
  bomLines: {
    orderBy: { createdAt: 'asc' as const },
    include: { item: { select: LINKED_ITEM_SELECT } },
  },
  stockMovements: {
    where: { kind: 'build' as const },
    orderBy: { createdAt: 'desc' as const },
    include: { item: { select: LINKED_ITEM_SELECT } },
  },
};

/** Reshapes a Prisma project-with-includes row into the public detail shape. */
function toProjectDetail<T extends { stockMovements: unknown }>(
  project: T,
): Omit<T, 'stockMovements'> & { consumed: T['stockMovements'] } {
  const { stockMovements, ...rest } = project;
  return { ...rest, consumed: stockMovements };
}

// ---------------------------------------------------------------------------
// backflush — response shapes (EVT-28)
// ---------------------------------------------------------------------------

/** One BOM line as shown on the pre-confirmation backflush screen. */
export interface BackflushPreviewLine {
  lineId: string;
  itemId: string | null;
  name: string;
  /** BOM line quantity (the plan). */
  quantity: number;
  unit: string | null;
  /** Current on-hand for the linked item; `null` for a free-text (skipped) line. */
  onHand: number | null;
  /** `min(quantity, onHand)` — the default consume quantity a confirm screen should preselect. */
  suggestedConsumeQuantity: number;
  /** `true` when `onHand < quantity` — the confirm screen should highlight this line. */
  shortage: boolean;
  /** `true` for a free-text (no `itemId`) line — "not tracked, skipped", never written. */
  skipped: boolean;
}

export interface BackflushPreview {
  projectId: string;
  /** `true` when this project already has recorded `build` movements (idempotency guard, AC 6). */
  alreadyBackflushed: boolean;
  lines: BackflushPreviewLine[];
}

/** One line actually written by a `backflush()` call. */
export interface BackflushConsumedLine {
  lineId: string;
  itemId: string;
  name: string;
  /** The (already line-quantity-clamped) amount the caller asked to consume. */
  requestedQuantity: number;
  /** The amount actually written — clamped to on-hand (AC 4). */
  consumedQuantity: number;
  /** `true` when `consumedQuantity < requestedQuantity` (on-hand ran short mid-confirm). */
  shortage: boolean;
  movementId: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  // -------------------------------------------------------------------------
  // list — GET /api/projects?status=
  // -------------------------------------------------------------------------

  /** List projects, newest first, each annotated with its BOM line count. */
  async list(query: ListProjectsQueryDto) {
    const where: Prisma.ProjectWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { bomLines: true } } },
    });

    return projects.map(({ _count, ...project }) => ({
      ...project,
      lineCount: _count.bomLines,
    }));
  }

  // -------------------------------------------------------------------------
  // findOne — GET /api/projects/:id
  // -------------------------------------------------------------------------

  /**
   * Full project detail: BOM lines with their linked item summary, plus the
   * `consumed` backflush history (EVT-28 AC 5) — every `build` movement
   * linked to this project, newest first, empty until first backflushed.
   */
  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: PROJECT_DETAIL_INCLUDE,
    });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return toProjectDetail(project);
  }

  // -------------------------------------------------------------------------
  // create — POST /api/projects
  // -------------------------------------------------------------------------

  async create(dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        status: dto.status,
        notes: dto.notes,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // update — PATCH /api/projects/:id
  // -------------------------------------------------------------------------

  async update(id: string, dto: UpdateProjectDto) {
    await this.assertProjectExists(id);

    const { startedAt, completedAt, ...scalarData } = dto;

    return this.prisma.project.update({
      where: { id },
      data: {
        ...scalarData,
        // Empty string clears the field; undefined leaves it untouched.
        ...(startedAt !== undefined && { startedAt: startedAt ? new Date(startedAt) : null }),
        ...(completedAt !== undefined && {
          completedAt: completedAt ? new Date(completedAt) : null,
        }),
      },
    });
  }

  // -------------------------------------------------------------------------
  // remove — DELETE /api/projects/:id
  // -------------------------------------------------------------------------

  /** Deletes a project. BOM lines cascade per schema (`BomLine.projectId onDelete: Cascade`). */
  async remove(id: string): Promise<void> {
    try {
      await this.prisma.project.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException(`Project ${id} not found`);
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // addBomLine — POST /api/projects/:id/bom
  // -------------------------------------------------------------------------

  /**
   * Adds a BOM line, either linked to an inventory item (its `name` is
   * copied, ignoring any `name` also present in the body) or free text.
   */
  async addBomLine(projectId: string, dto: CreateBomLineDto) {
    await this.assertProjectExists(projectId);

    let name = dto.name;
    let itemId: string | null = null;

    if (dto.itemId) {
      const item = await this.prisma.item.findUnique({
        where: { id: dto.itemId },
        select: { id: true, name: true },
      });
      if (!item) {
        throw new NotFoundException(`Item ${dto.itemId} not found`);
      }
      itemId = item.id;
      name = item.name;
    } else if (!dto.name) {
      throw new BadRequestException('Either itemId or name must be provided for a BOM line');
    }

    return this.prisma.bomLine.create({
      data: {
        projectId,
        itemId,
        name: name as string,
        quantity: dto.quantity,
        unit: dto.unit,
        notes: dto.notes,
      },
      include: { item: { select: LINKED_ITEM_SELECT } },
    });
  }

  // -------------------------------------------------------------------------
  // updateBomLine — PATCH /api/projects/:id/bom/:lineId
  // -------------------------------------------------------------------------

  async updateBomLine(projectId: string, lineId: string, dto: UpdateBomLineDto) {
    await this.assertBomLineExists(projectId, lineId);

    let name = dto.name;

    if (dto.itemId) {
      const item = await this.prisma.item.findUnique({
        where: { id: dto.itemId },
        select: { id: true, name: true },
      });
      if (!item) {
        throw new NotFoundException(`Item ${dto.itemId} not found`);
      }
      name = item.name;
    }

    return this.prisma.bomLine.update({
      where: { id: lineId },
      data: {
        ...(dto.itemId !== undefined && { itemId: dto.itemId }),
        ...(name !== undefined && { name }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: { item: { select: LINKED_ITEM_SELECT } },
    });
  }

  // -------------------------------------------------------------------------
  // removeBomLine — DELETE /api/projects/:id/bom/:lineId
  // -------------------------------------------------------------------------

  async removeBomLine(projectId: string, lineId: string): Promise<void> {
    await this.assertBomLineExists(projectId, lineId);
    await this.prisma.bomLine.delete({ where: { id: lineId } });
  }

  // -------------------------------------------------------------------------
  // previewBackflush — GET /api/projects/:id/backflush-preview (EVT-28)
  // -------------------------------------------------------------------------

  /**
   * Builds the pre-confirmation backflush screen (AC 1): every item-linked
   * BOM line with its current on-hand and a suggested (on-hand-clamped)
   * consume quantity, shortages flagged; free-text lines listed as
   * `skipped: true`. Read-only — writes nothing.
   */
  async previewBackflush(id: string): Promise<BackflushPreview> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        bomLines: {
          orderBy: { createdAt: 'asc' },
          include: { item: { select: { id: true, quantity: true } } },
        },
      },
    });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    const alreadyBackflushedCount = await this.prisma.stockMovement.count({
      where: { projectId: id, kind: 'build' },
    });

    const lines: BackflushPreviewLine[] = project.bomLines.map((line) => {
      if (!line.item) {
        return {
          lineId: line.id,
          itemId: null,
          name: line.name,
          quantity: line.quantity,
          unit: line.unit,
          onHand: null,
          suggestedConsumeQuantity: 0,
          shortage: false,
          skipped: true,
        };
      }
      const onHand = line.item.quantity;
      return {
        lineId: line.id,
        itemId: line.item.id,
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
        onHand,
        suggestedConsumeQuantity: clamp(line.quantity, 0, onHand),
        shortage: onHand < line.quantity,
        skipped: false,
      };
    });

    return { projectId: id, alreadyBackflushed: alreadyBackflushedCount > 0, lines };
  }

  // -------------------------------------------------------------------------
  // backflush — POST /api/projects/:id/backflush (EVT-28)
  // -------------------------------------------------------------------------

  /**
   * Confirms the backflush: writes one `build` movement per consumed
   * item-linked line (via `StockMovementsService.recordConsumption`, which
   * also atomically, race-safely decrements `Item.quantity` — see that
   * method's doc comment) and marks the project `completed`, all inside a
   * single `$transaction` (AC 2) — a mid-loop failure (e.g. one item's write
   * rejects) throws before the project status update runs, so nothing lands
   * partially.
   *
   * `dto.lines` entries for a free-text BOM line, or omitted lines, are
   * skipped — no movement is written for them (AC 3). Duplicate `lineId`
   * entries in `dto.lines` are collapsed to their last occurrence BEFORE
   * anything is clamped or written (review round 2, finding 3) — otherwise a
   * client repeating the same line N times would multiply its consumption N×
   * past the per-line cap. Each requested quantity is then clamped to
   * `[0, line.quantity]` (the per-line override contract, AC 1/2); the
   * *actual* on-hand clamp (AC 4) happens inside `recordConsumption` itself,
   * atomically with the decrement, so it can never drive `Item.quantity`
   * negative even under concurrent backflush confirms racing the same item.
   *
   * Idempotency guard (AC 6, EVT-28 risk): if this project already has
   * `build` movements, the call is rejected with `ConflictException` unless
   * `dto.confirmAgain` is `true`. The count + guard decision run INSIDE the
   * `$transaction`, immediately before any writes (review round 2, finding
   * 2) — the previous shape counted before the transaction opened, leaving a
   * TOCTOU window where two concurrent first-time confirms could both
   * observe zero existing `build` movements and both proceed.
   */
  // Return type is inferred (rather than annotated) so `toProjectDetail`'s
  // generic resolves against the actual `tx.project.update(...)` payload
  // below, not its unconstrained default — see that helper's doc comment.
  async backflush(id: string, dto: BackflushDto, createdById?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { bomLines: true },
    });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    const bomLinesById = new Map(project.bomLines.map((line) => [line.id, line]));

    // De-dupe by lineId (last entry wins) BEFORE resolving/clamping —
    // `new Map(pairs)` keeps each key's first insertion position but its
    // LAST assigned value, which is exactly "collapse duplicates, last
    // wins" (finding 3).
    const dedupedByLineId = new Map(dto.lines.map((entry) => [entry.lineId, entry]));

    const requested: { line: (typeof project.bomLines)[number]; requestedQuantity: number }[] = [];
    for (const entry of dedupedByLineId.values()) {
      const line = bomLinesById.get(entry.lineId);
      if (!line) {
        throw new NotFoundException(`BOM line ${entry.lineId} not found on project ${id}`);
      }
      if (!line.itemId) {
        continue; // free-text line — "not tracked", never written (AC 3)
      }
      requested.push({ line, requestedQuantity: clamp(entry.consumeQuantity, 0, line.quantity) });
    }

    return this.prisma.$transaction(async (tx) => {
      // Idempotency guard (AC 6) — see doc comment above (finding 2).
      const existingBuildCount = await tx.stockMovement.count({
        where: { projectId: id, kind: 'build' },
      });
      if (existingBuildCount > 0 && !dto.confirmAgain) {
        throw new ConflictException(
          `Project ${id} was already backflushed; pass confirmAgain to consume again`,
        );
      }

      const consumed: BackflushConsumedLine[] = [];

      for (const { line, requestedQuantity } of requested) {
        if (requestedQuantity <= 0) {
          continue;
        }

        // Race-safe consume (finding 1) — see `recordConsumption`'s doc
        // comment. `result` is `null` when on-hand was already 0 (or hit 0
        // mid-loop): nothing to write, skip this line.
        const result = await this.stockMovementsService.recordConsumption(tx, {
          itemId: line.itemId as string,
          kind: 'build',
          requestedQuantity,
          projectId: id,
          note: 'Backflush: project completion',
          createdById,
        });
        if (!result) {
          continue;
        }

        consumed.push({
          lineId: line.id,
          itemId: line.itemId as string,
          name: line.name,
          requestedQuantity,
          consumedQuantity: result.consumedQuantity,
          shortage: result.consumedQuantity < requestedQuantity,
          movementId: result.movement.id,
        });
      }

      const updated = await tx.project.update({
        where: { id },
        data: { status: 'completed', completedAt: new Date() },
        include: PROJECT_DETAIL_INCLUDE,
      });

      return { project: toProjectDetail(updated), consumed };
    });
  }

  // -------------------------------------------------------------------------
  // internal helpers
  // -------------------------------------------------------------------------

  private async assertProjectExists(id: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
  }

  /** Verifies the BOM line exists AND belongs to the given project. */
  private async assertBomLineExists(projectId: string, lineId: string): Promise<void> {
    const line = await this.prisma.bomLine.findUnique({ where: { id: lineId } });
    if (!line || line.projectId !== projectId) {
      throw new NotFoundException(`BOM line ${lineId} not found on project ${projectId}`);
    }
  }
}

/** Clamps `value` to `[min, max]`. Used throughout backflush to keep every consume quantity within bounds (AC 4: never negative, never above on-hand or the line's plan). */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
