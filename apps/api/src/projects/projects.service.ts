import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

/** Full detail: BOM lines (incl. linked item summary), oldest line first. */
const PROJECT_DETAIL_INCLUDE = {
  bomLines: {
    orderBy: { createdAt: 'asc' as const },
    include: { item: { select: LINKED_ITEM_SELECT } },
  },
};

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Full project detail: BOM lines with their linked item summary. */
  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: PROJECT_DETAIL_INCLUDE,
    });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
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
