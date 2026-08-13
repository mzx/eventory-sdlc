import {
  BadRequestException,
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
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { uploadThrottlerConfig } from '../common/throttle.config';
import { PayloadTooLargeFilter } from '../photos/photo-upload.helpers';
import { ListMovementsQueryDto } from '../stock-movements/list-movements-query.dto';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { CreateItemDto } from './create-item.dto';
import { ItemsService } from './items.service';
import { ListItemsQueryDto } from './list-items-query.dto';
import { ReceiveItemDto } from './receive-item.dto';
import { searchByPhotoMulterOptions } from './search-by-photo.helpers';
import { UpdateItemDto } from './update-item.dto';

@Controller('items')
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  /**
   * GET /api/items?search=&tag=&locationId=
   *
   * List items, newest first. All query params are optional filters:
   * - `search` — ILIKE against name, description, and properties JSONB.
   * - `tag`    — items carrying a tag with this exact name.
   * - `locationId` — items in this location or any descendant (subtree).
   */
  @Get()
  list(@Query() query: ListItemsQueryDto) {
    return this.itemsService.list(query);
  }

  /**
   * GET /api/items/by-qr/:qr
   *
   * Resolve a QR token to an item or a location.
   * Returns `{ kind: "item", item }` or `{ kind: "location", location }`.
   * 404 when the token matches neither table.
   *
   * NOTE: This route MUST be declared before `/:id` so NestJS doesn't
   * treat "by-qr" as a UUID and route it to `findById`.
   */
  @Get('by-qr/:qr')
  findByQr(@Param('qr') qr: string) {
    return this.itemsService.findByQr(qr);
  }

  /**
   * GET /api/items/:id
   *
   * Full item detail: photos, tags, location, category.
   * 404 when the item does not exist.
   */
  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemsService.findById(id);
  }

  /**
   * GET /api/items/:id/movements?page=&pageSize=
   *
   * Paginated stock movement history for one item, newest first (EVT-25 AC
   * 5). Each row carries the movement `kind`, signed `delta`, from/to
   * location names (for `move`), the linked project summary when present,
   * and `createdAt`. 404 when the item does not exist.
   */
  @Get(':id/movements')
  listMovements(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListMovementsQueryDto) {
    return this.stockMovementsService.listForItem(id, query);
  }

  /**
   * POST /api/items/search-by-photo
   *
   * Multipart photo upload (`file` field). Runs the EVT-7 Claude vision
   * analysis against the photo (the photo itself is NEVER persisted — see
   * `search-by-photo.helpers.ts`) and searches existing items using the
   * analysis's suggested name, search keywords, and tags. Returns
   * `{ analysis, matches }`; `matches` is list-shape items (same as
   * `GET /api/items`), ranked by distinct search-term hit count.
   *
   * Wrong mimetype → 415. Oversized (>5 MB, the vision-analysis ceiling,
   * stricter than the general upload ceiling since nothing here is stored)
   * → 400.
   *
   * Rate-limited with the same strict throttle as `POST /api/photos/upload`
   * (see `common/throttle.config.ts`) — this route triggers the same billed
   * Anthropic vision call with no auth guard in front of it (EVT-7 review
   * round 2, finding 1).
   */
  @Post('search-by-photo')
  @Throttle(uploadThrottlerConfig())
  @HttpCode(HttpStatus.OK)
  @UseFilters(new PayloadTooLargeFilter('File exceeds the 5 MB search-by-photo upload limit'))
  @UseInterceptors(FileInterceptor('file', searchByPhotoMulterOptions))
  searchByPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.itemsService.searchByPhoto(file.buffer, file.mimetype);
  }

  /**
   * POST /api/items
   *
   * Create an item. Tags are upserted by name. Returns 201 with the new item.
   * `createdById` is stamped from the caller's session (EVT-14) — this
   * route requires an approved user, so `user` is always present here.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.itemsService.create(dto, user.id);
  }

  /**
   * POST /api/items/:id/receive
   *
   * Distributor barcode receiving's "add to existing" branch (EVT-31 AC 4):
   * re-scanning a known MPN records an `add` movement for `quantity`
   * against this item instead of creating a duplicate. Attributed to the
   * caller. 404 when the item does not exist.
   */
  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itemsService.receive(id, dto.quantity, user.id);
  }

  /**
   * PATCH /api/items/:id
   *
   * Partial update. When `tags` is provided, the tag list is fully replaced.
   * A changed `quantity` or `locationId` writes a matching `adjust`/`move`
   * stock movement (EVT-25 AC 3/4), attributed to the caller. 404 when the
   * item does not exist.
   */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itemsService.update(id, dto, user.id);
  }

  /**
   * DELETE /api/items/:id
   *
   * Delete an item (cascades photos and tag associations per schema).
   * Returns 204 No Content on success.
   * 404 when the item does not exist.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.itemsService.remove(id);
  }
}
