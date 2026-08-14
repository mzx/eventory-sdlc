import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ShoppingListPage } from './ShoppingListPage';

function entry(overrides: Partial<api.ShoppingListEntry> = {}): api.ShoppingListEntry {
  return {
    id: 'entry-1',
    itemId: 'item-1',
    status: 'open',
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    item: {
      id: 'item-1',
      name: 'Box of Screws',
      quantity: 2,
      minQuantity: 5,
      qrCode: 'qr-1',
      primaryPhoto: null,
      location: { id: 'loc-1', name: 'Garage', path: 'garage' },
    },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/shopping-list']}>
        <Routes>
          <Route path="/shopping-list" element={<ShoppingListPage />} />
          <Route path="/items/:id" element={<div>item detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ShoppingListPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // AC 4 — list shape + empty state
  // =========================================================================

  it('renders open entries with name, on-hand/min, and location', async () => {
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([entry()]);

    renderPage();

    expect(await screen.findByText('Box of Screws')).toBeInTheDocument();
    expect(screen.getByText('2 / min 5 — Garage')).toBeInTheDocument();
  });

  it('shows a designed empty state, not a blank page, when there are no open entries', async () => {
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/all stocked up/i)).toBeInTheDocument();
  });

  it('shows an error alert when the list fails to load', async () => {
    vi.spyOn(api, 'fetchShoppingList').mockRejectedValue(new Error('boom'));

    renderPage();

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('links the item name to its detail page', async () => {
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([entry()]);
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole('link', { name: 'Box of Screws' }));
    expect(await screen.findByText('item detail page')).toBeInTheDocument();
  });

  // =========================================================================
  // EVT-37 finding #6 — the "Restocked" button sits in a normal flex row
  // (not `secondaryAction`, which only reserves 48px) so it never overlaps
  // the item name/summary, and a long name truncates with an ellipsis
  // instead of pushing the button off-row at ~390px.
  // =========================================================================

  it('EVT-37 AC2: a long item name truncates (noWrap) instead of wrapping onto the Restocked button', async () => {
    const longName = 'B'.repeat(120);
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([
      entry({ item: { ...entry().item, name: longName } }),
    ]);

    renderPage();

    const nameLink = await screen.findByText(longName);
    expect(nameLink).toHaveClass('MuiTypography-noWrap');
    expect(screen.getByText('2 / min 5 — Garage')).toHaveClass('MuiTypography-noWrap');
    // A normal flex row (not `secondaryAction`, which absolutely positions
    // and only reserves 48px) — the button never overlaps the text column.
    const rowEl = nameLink.closest('li');
    expect(rowEl?.querySelector('.MuiListItemSecondaryAction-root')).toBeNull();
    expect(screen.getByRole('button', { name: 'Restocked' })).toBeInTheDocument();
  });

  // =========================================================================
  // AC 5 — restock
  // =========================================================================

  describe('Restocked', () => {
    it('prompts for the new quantity, records the restock, and removes the entry from the list', async () => {
      const listMock = vi
        .spyOn(api, 'fetchShoppingList')
        .mockResolvedValueOnce([entry()])
        .mockResolvedValueOnce([]);
      const restockMock = vi.spyOn(api, 'restockShoppingListEntry').mockResolvedValue({
        ...entry(),
        status: 'done',
        resolvedAt: '2026-01-02T00:00:00.000Z',
      });
      const user = userEvent.setup();

      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Restocked' }));
      const dialog = await screen.findByRole('dialog');

      const quantityInput = await screen.findByLabelText('New quantity');
      await user.clear(quantityInput);
      await user.type(quantityInput, '50');
      await user.click(within(dialog).getByRole('button', { name: 'Restocked' }));

      await waitFor(() => expect(restockMock).toHaveBeenCalledWith('entry-1', 50));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/all stocked up/i)).toBeInTheDocument();
    });

    it('shows an error alert when the restock fails, without closing the dialog', async () => {
      vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([entry()]);
      vi.spyOn(api, 'restockShoppingListEntry').mockRejectedValue(
        new Error('Shopping list entry entry-1 is already resolved'),
      );
      const user = userEvent.setup();

      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Restocked' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Restocked' }));

      expect(
        await within(dialog).findByText('Shopping list entry entry-1 is already resolved'),
      ).toBeInTheDocument();
    });

    it('prefills the quantity field with the item’s current on-hand count', async () => {
      vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([
        entry({ item: { ...entry().item, quantity: 3 } }),
      ]);
      const user = userEvent.setup();

      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Restocked' }));
      const quantityInput = await screen.findByLabelText('New quantity');
      expect(quantityInput).toHaveValue(3);
    });
  });
});
