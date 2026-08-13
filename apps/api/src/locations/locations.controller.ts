import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { ListMovementsQueryDto } from '../stock-movements/list-movements-query.dto';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { CreateLocationDto } from './create-location.dto';
import { LocationsService } from './locations.service';
import { MoveLocationDto } from './move-location.dto';
import { RenameLocationDto } from './rename-location.dto';

@Controller('locations')
export class LocationsController {
  constructor(
    private readonly locationsService: LocationsService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  /** GET /api/locations — flat list ordered by path. */
  @Get()
  findAll() {
    return this.locationsService.findAll();
  }

  /**
   * GET /api/locations/by-qr/:qr — must be declared BEFORE :id so NestJS does
   * not try to treat "by-qr" as a UUID.
   */
  @Get('by-qr/:qr')
  findByQr(@Param('qr') qr: string) {
    return this.locationsService.findByQr(qr);
  }

  /** GET /api/locations/:id — detail with children, items, breadcrumb. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.locationsService.findOne(id);
  }

  /**
   * GET /api/locations/:id/movements?page=&pageSize= — a container's own
   * re-parent history, newest first (EVT-30 AC 3). 404 when the location
   * doesn't exist or is not a `container`.
   *
   * `ParseUUIDPipe` on `id` (EVT-30 review round 2, finding 2) — without it
   * a non-UUID id reached Prisma's `@db.Uuid` column and raised P2023 → 500
   * instead of a clean 400.
   */
  @Get(':id/movements')
  listMovements(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListMovementsQueryDto) {
    return this.stockMovementsService.listForContainer(id, query);
  }

  /** POST /api/locations — create a location (root or child of parentId). */
  @Post()
  create(@Body() body: CreateLocationDto) {
    return this.locationsService.create(body);
  }

  /**
   * POST /api/locations/:id/move — "Move to…" (EVT-30 AC 2). `toParentId:
   * null` (or omitted) moves the container to root. Container-only (400 on
   * an `area`); rejects a cycle into itself/its own descendants (422, AC 4).
   *
   * `ParseUUIDPipe` on `id` (EVT-30 review round 2, finding 2) — see
   * `listMovements`'s doc comment for the rationale.
   */
  @Post(':id/move')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MoveLocationDto,
    @CurrentUser() user: AuthenticatedUser | null,
  ) {
    return this.locationsService.moveContainer(id, body.toParentId ?? null, user?.id);
  }

  /** PATCH /api/locations/:id — rename + atomic descendant path rewrite. */
  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() body: RenameLocationDto) {
    return this.locationsService.rename(id, body.name);
  }

  /** DELETE /api/locations/:id — only when no children; items become unlocated. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.locationsService.remove(id);
  }
}
