import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { CreateShoppingListEntryDto, RestockShoppingListEntryDto } from './shopping-list.dto';
import { ShoppingListService } from './shopping-list.service';

@Controller('shopping-list')
export class ShoppingListController {
  constructor(private readonly shoppingListService: ShoppingListService) {}

  /**
   * GET /api/shopping-list
   *
   * Open entries, oldest first — item name, thumbnail, on-hand/min,
   * location (EVT-26 AC 4). Its length is also what the web nav badge
   * counts (AC 6).
   */
  @Get()
  listOpen() {
    return this.shoppingListService.listOpen();
  }

  /**
   * POST /api/shopping-list
   *
   * The "Running low" one-tap action (EVT-26 AC 3). Idempotent — tapping an
   * item that already has an open entry returns that entry rather than
   * erroring. 404 for an unknown item.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  createManual(@Body() dto: CreateShoppingListEntryDto) {
    return this.shoppingListService.createManual(dto.itemId);
  }

  /**
   * POST /api/shopping-list/:id/restock
   *
   * Records an `add` movement for the counted quantity and closes the entry
   * (EVT-26 AC 5). 404 for an unknown entry; 409 if already resolved.
   */
  @Post(':id/restock')
  @HttpCode(HttpStatus.OK)
  restock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestockShoppingListEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shoppingListService.restock(id, dto.quantity, user.id);
  }
}
