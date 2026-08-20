import { Test, TestingModule } from '@nestjs/testing';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListService } from './shopping-list.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-1111-1111-111111111111';
const ENTRY_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const WORKSPACE_ID = '44444444-4444-4444-4444-444444444444';
/** Minimal `AuthenticatedUser` stand-in — only `.id` is read by the controller. */
const CURRENT_USER = { id: USER_ID } as never;
/** Minimal `WorkspaceContext` stand-in — only `.id` is read by the controller. */
const WORKSPACE = { id: WORKSPACE_ID, role: 'owner' } as never;

function makeShoppingListServiceMock() {
  return {
    listOpen: jest.fn(),
    createManual: jest.fn(),
    restock: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ShoppingListController', () => {
  let controller: ShoppingListController;
  let serviceMock: ReturnType<typeof makeShoppingListServiceMock>;

  beforeEach(async () => {
    serviceMock = makeShoppingListServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShoppingListController],
      providers: [{ provide: ShoppingListService, useValue: serviceMock }],
    }).compile();

    controller = module.get<ShoppingListController>(ShoppingListController);
  });

  // =========================================================================
  // GET /api/shopping-list — AC 4
  // =========================================================================

  it('listOpen delegates to the service with the caller workspace', async () => {
    const entries = [{ id: ENTRY_ID }];
    serviceMock.listOpen.mockResolvedValue(entries);

    const result = await controller.listOpen(WORKSPACE);

    expect(serviceMock.listOpen).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(result).toBe(entries);
  });

  // =========================================================================
  // POST /api/shopping-list — AC 3
  // =========================================================================

  it('createManual forwards itemId from the DTO and the caller workspace', async () => {
    const entry = { id: ENTRY_ID, itemId: ITEM_ID, source: 'manual' };
    serviceMock.createManual.mockResolvedValue(entry);

    const result = await controller.createManual({ itemId: ITEM_ID }, WORKSPACE);

    expect(serviceMock.createManual).toHaveBeenCalledWith(ITEM_ID, WORKSPACE_ID);
    expect(result).toBe(entry);
  });

  // =========================================================================
  // POST /api/shopping-list/:id/restock — AC 5
  // =========================================================================

  it('restock forwards entry id, quantity, the caller workspace, and the acting user id', async () => {
    const resolved = { id: ENTRY_ID, status: 'done' };
    serviceMock.restock.mockResolvedValue(resolved);

    const result = await controller.restock(ENTRY_ID, { quantity: 10 }, CURRENT_USER, WORKSPACE);

    expect(serviceMock.restock).toHaveBeenCalledWith(ENTRY_ID, 10, WORKSPACE_ID, USER_ID);
    expect(result).toBe(resolved);
  });
});
