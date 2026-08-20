import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { CurrentWorkspace, WorkspaceContext } from '../workspace/workspace-context';
import { WorkspaceWriteGuard } from '../workspace/workspace-write.guard';
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
   * counts (AC 6). Scoped to the caller's active workspace (EVT-41).
   */
  @Get()
  listOpen(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.shoppingListService.listOpen(workspace.id);
  }

  /**
   * POST /api/shopping-list
   *
   * The "Running low" one-tap action (EVT-26 AC 3). Idempotent — tapping an
   * item that already has an open entry returns that entry rather than
   * erroring. 404 for an unknown item OR an item belonging to a different
   * workspace (EVT-41). Mutating — a `viewer` gets 403.
   */
  @Post()
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.OK)
  createManual(
    @Body() dto: CreateShoppingListEntryDto,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.shoppingListService.createManual(dto.itemId, workspace.id);
  }

  /**
   * POST /api/shopping-list/:id/restock
   *
   * Records an `add` movement for the counted quantity and closes the entry
   * (EVT-26 AC 5). 404 for an unknown entry OR an entry belonging to a
   * different workspace (EVT-41); 409 if already resolved. Mutating — a
   * `viewer` gets 403.
   */
  @Post(':id/restock')
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.OK)
  restock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestockShoppingListEntryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.shoppingListService.restock(id, dto.quantity, workspace.id, user.id);
  }
}
