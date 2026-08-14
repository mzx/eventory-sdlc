import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ItemDetailPage } from './ItemDetailPage';

const detail = (overrides: Partial<api.ItemDetail> = {}): api.ItemDetail => ({
  id: 'item-1',
  name: 'Cordless drill',
  description: 'Great for shelving',
  quantity: 2,
  minQuantity: null,
  unit: 'units',
  properties: { voltage: '18V', brand: 'Bosch' },
  qrCode: 'qr-token-1',
  locationId: 'loc-1',
  categoryId: 'cat-1',
  primaryPhotoId: 'photo-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tags: [
    { itemId: 'item-1', tagId: 'tag-1', tag: { id: 'tag-1', name: 'power-tools', color: null } },
  ],
  location: { id: 'loc-1', name: 'Cabinet 3', path: 'garage.cabinet-3' },
  category: { id: 'cat-1', name: 'Hand tools', path: 'hand-tools' },
  primaryPhoto: { id: 'photo-1', filename: 'primary.jpg', mimeType: 'image/jpeg' },
  photos: [
    { id: 'photo-2', filename: 'second.jpg', mimeType: 'image/jpeg' },
    { id: 'photo-1', filename: 'primary.jpg', mimeType: 'image/jpeg' },
  ],
  ...overrides,
});

/** Default (empty) `GET /api/items/:id/movements` page — overridable per test. */
const movementsPage = (
  overrides: Partial<api.StockMovementsPage> = {},
): api.StockMovementsPage => ({
  data: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  ...overrides,
});

const movementRow = (overrides: Partial<api.StockMovementRow> = {}): api.StockMovementRow => ({
  id: 'mv-1',
  itemId: 'item-1',
  kind: 'adjust',
  delta: 3,
  fromLocationId: null,
  toLocationId: null,
  projectId: null,
  note: null,
  createdById: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  fromLocation: null,
  toLocation: null,
  project: null,
  ...overrides,
});

function renderDetailPage(id = 'item-1', options: { state?: { justCreated?: boolean } } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: `/items/${id}`, state: options.state }]}>
        <Routes>
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/items/:id/edit" element={<div>edit page</div>} />
          <Route path="/items/:id/print" element={<div>print page</div>} />
          <Route path="/projects/:id" element={<div>project detail page</div>} />
          <Route path="/" element={<div>items list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ItemDetailPage', () => {
  beforeEach(() => {
    // Every test renders the History section — default to an empty page so
    // tests that don't care about EVT-25 history don't need their own mock.
    vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(movementsPage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders name, quantity, description, tags, location, category, and properties', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

    renderDetailPage();

    expect(await screen.findByText('Cordless drill')).toBeInTheDocument();
    expect(screen.getByText(/Qty: 2 units/)).toBeInTheDocument();
    expect(screen.getByText('Great for shelving')).toBeInTheDocument();
    expect(screen.getByText('power-tools')).toBeInTheDocument();
    expect(screen.getByText('Cabinet 3')).toBeInTheDocument();
    expect(screen.getByText(/Category: hand-tools/)).toBeInTheDocument();
    expect(screen.getByText('voltage')).toBeInTheDocument();
    expect(screen.getByText('18V')).toBeInTheDocument();
    expect(screen.getByText('brand')).toBeInTheDocument();
    expect(screen.getByText('Bosch')).toBeInTheDocument();
  });

  it('renders Edit as the visually primary action, grouped with the item title, and navigates to the edit route on click (gh-issue-34)', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByText('Cordless drill');
    const heading = screen.getByRole('heading', { name: 'Cordless drill' });
    const editButton = screen.getByRole('button', { name: /edit/i });
    const deleteButton = screen.getByRole('button', { name: /delete/i });

    // Edit is grouped in the same header row as the item title, rather than
    // floating alone at the top of the page.
    const header = heading.closest('div')?.parentElement;
    expect(header).not.toBeNull();
    expect(header).toContainElement(editButton);

    // Edit reads as the primary action (filled/contained); Delete stays
    // available but visually subordinate (outlined, not filled).
    expect(editButton.className).toContain('MuiButton-contained');
    expect(deleteButton.className).toContain('MuiButton-outlined');

    await user.click(editButton);
    expect(await screen.findByText('edit page')).toBeInTheDocument();
  });

  it('renders the QR sticker image using the item qrCode', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

    renderDetailPage();

    const qr = await screen.findByAltText('QR code');
    expect(qr).toHaveAttribute('src', expect.stringContaining('qr-token-1'));
  });

  it('renders the location breadcrumb without duplicating the leaf segment or linking to a blank page', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

    renderDetailPage();

    const breadcrumb = await screen.findByLabelText('location breadcrumb');
    expect(within(breadcrumb).getByText('garage')).toBeInTheDocument();
    // 'Cabinet 3' should render exactly once (the leaf), not also as its raw
    // path segment 'cabinet-3'.
    expect(within(breadcrumb).getByText('Cabinet 3')).toBeInTheDocument();
    expect(within(breadcrumb).queryByText('cabinet-3')).not.toBeInTheDocument();
    // No locations detail page exists yet (EVT-12), so the leaf must not be a link.
    expect(within(breadcrumb).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an error alert if deleting the item fails', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    vi.spyOn(api, 'deleteItem').mockRejectedValue(new Error('Cannot delete: item is referenced'));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByText('Cordless drill');
    await user.click(screen.getByRole('button', { name: /delete/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await within(dialog).findByText('Cannot delete: item is referenced'),
    ).toBeInTheDocument();
  });

  it('clears the stale delete error when the dialog is closed and reopened', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    vi.spyOn(api, 'deleteItem').mockRejectedValue(new Error('Cannot delete: item is referenced'));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByText('Cordless drill');

    // First attempt fails and shows the error.
    await user.click(screen.getByRole('button', { name: /delete/i }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(
      await within(dialog).findByText('Cannot delete: item is referenced'),
    ).toBeInTheDocument();

    // Close without retrying.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Reopen — the stale error must not still be shown.
    await user.click(screen.getByRole('button', { name: /delete/i }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Cannot delete: item is referenced')).not.toBeInTheDocument();
  });

  it('deletes the item and navigates back to the list after confirming', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    const deleteMock = vi.spyOn(api, 'deleteItem').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByText('Cordless drill');
    await user.click(screen.getByRole('button', { name: /delete/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('item-1'));
    expect(await screen.findByText('items list')).toBeInTheDocument();
  });

  it('shows the "Print QR" toast when navigated here with justCreated state, and navigates to the print route on click', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    const user = userEvent.setup();

    renderDetailPage('item-1', { state: { justCreated: true } });

    await screen.findByText('Cordless drill');
    expect(await screen.findByText('Item saved')).toBeInTheDocument();
    const printButton = screen.getByRole('button', { name: 'Print QR' });

    await user.click(printButton);

    expect(await screen.findByText('print page')).toBeInTheDocument();
  });

  it('does not show the "Print QR" toast without justCreated navigation state', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

    renderDetailPage('item-1');

    await screen.findByText('Cordless drill');
    expect(screen.queryByText('Item saved')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print QR' })).not.toBeInTheDocument();
  });

  // =========================================================================
  // History section (EVT-25 AC 6)
  // =========================================================================

  describe('History (EVT-25)', () => {
    it('renders the History section heading', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

      renderDetailPage();

      expect(await screen.findByText('History')).toBeInTheDocument();
    });

    it('shows an empty-state message when the item has no movements yet', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

      renderDetailPage();

      expect(await screen.findByText('No movements recorded yet.')).toBeInTheDocument();
    });

    it('renders kind, delta, and relative time for an "adjust" movement', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({
          data: [movementRow({ kind: 'adjust', delta: 4, createdAt: new Date().toISOString() })],
          total: 1,
        }),
      );

      renderDetailPage();

      const history = await screen.findByLabelText('item movement history');
      expect(within(history).getByText('Adjusted +4')).toBeInTheDocument();
      expect(within(history).getByText('just now')).toBeInTheDocument();
    });

    it('review round 2, finding 4: a negative-delta "build" movement reads "Consumed in build", not "Built -2"', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({
          data: [
            movementRow({
              kind: 'build',
              delta: -2,
              project: { id: 'proj-1', name: 'Garage Shelving' },
            }),
          ],
          total: 1,
        }),
      );

      renderDetailPage();

      const history = await screen.findByLabelText('item movement history');
      expect(within(history).getByText('Consumed in build -2')).toBeInTheDocument();
      expect(within(history).queryByText(/^Built/)).not.toBeInTheDocument();
    });

    it('renders a negative delta for a shrinking "adjust" movement', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({ data: [movementRow({ kind: 'adjust', delta: -6 })], total: 1 }),
      );

      renderDetailPage();

      const history = await screen.findByLabelText('item movement history');
      expect(within(history).getByText('Adjusted -6')).toBeInTheDocument();
    });

    it('AC 4: renders both location names for a "move" movement', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({
          data: [
            movementRow({
              kind: 'move',
              delta: 0,
              fromLocation: { id: 'loc-1', name: 'Garage', path: 'garage' },
              toLocation: { id: 'loc-2', name: 'Cabinet 3', path: 'garage.cabinet-3' },
            }),
          ],
          total: 1,
        }),
      );

      renderDetailPage();

      const history = await screen.findByLabelText('item movement history');
      expect(within(history).getByText('Moved — Garage → Cabinet 3')).toBeInTheDocument();
    });

    it('renders a link to the linked project when present', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({
          data: [movementRow({ project: { id: 'proj-1', name: 'Garage Shelving' } })],
          total: 1,
        }),
      );
      const user = userEvent.setup();

      renderDetailPage();

      const history = await screen.findByLabelText('item movement history');
      const projectLink = within(history).getByRole('link', { name: 'Garage Shelving' });
      await user.click(projectLink);
      expect(await screen.findByText('project detail page')).toBeInTheDocument();
    });

    it('shows a "Load more" button when more movements exist than are shown, and it fetches a bigger page', async () => {
      const fetchMovements = vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({
          data: [movementRow({ id: 'mv-1' })],
          total: 2,
          pageSize: 20,
        }),
      );
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      const user = userEvent.setup();

      renderDetailPage();

      const loadMoreButton = await screen.findByRole('button', { name: 'Load more' });
      fetchMovements.mockResolvedValue(
        movementsPage({
          data: [movementRow({ id: 'mv-1' }), movementRow({ id: 'mv-2' })],
          total: 2,
          pageSize: 40,
        }),
      );
      await user.click(loadMoreButton);

      await waitFor(() =>
        expect(fetchMovements).toHaveBeenLastCalledWith('item-1', { page: 1, pageSize: 40 }),
      );
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    // EVT-25 review round 2, finding 2 — "Load more" must never grow the
    // requested pageSize past the backend's @Max(100) cap.
    it('finding 2: clamps the pageSize at 100 and hides "Load more" once the cap is reached', async () => {
      const fetchMovements = vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({
          data: [movementRow({ id: 'mv-1' })],
          total: 200,
          pageSize: 100,
        }),
      );
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      const user = userEvent.setup();

      renderDetailPage();

      // Click "Load more" repeatedly (20 -> 40 -> 60 -> 80 -> 100); each
      // click's fetch must never request a pageSize over 100.
      for (let i = 0; i < 4; i++) {
        const loadMoreButton = await screen.findByRole('button', { name: 'Load more' });
        await user.click(loadMoreButton);
      }

      await waitFor(() =>
        expect(fetchMovements).toHaveBeenLastCalledWith('item-1', { page: 1, pageSize: 100 }),
      );
      for (const call of fetchMovements.mock.calls) {
        expect(call[1]?.pageSize).toBeLessThanOrEqual(100);
      }
      // At the cap, with more movements still available (total: 200), the
      // button must be gone rather than triggering a 5th, over-cap request.
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
      expect(await screen.findByText('Showing the first 100 movements.')).toBeInTheDocument();
    });

    it('does not show "Load more" once every movement is already displayed', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      vi.spyOn(api, 'fetchItemMovements').mockResolvedValue(
        movementsPage({ data: [movementRow()], total: 1 }),
      );

      renderDetailPage();

      await screen.findByLabelText('item movement history');
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    it('shows an error alert when the history fails to load', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      vi.spyOn(api, 'fetchItemMovements').mockRejectedValue(new Error('boom'));

      renderDetailPage();

      expect(await screen.findByText('Failed to load history')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // "Running low" one-tap trigger (EVT-26 AC 3)
  // =========================================================================

  describe('"Running low" (EVT-26)', () => {
    it('shows the minimum quantity alongside on-hand quantity when set', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ minQuantity: 5 }));

      renderDetailPage();

      expect(await screen.findByText(/Qty: 2 units \(min 5\)/)).toBeInTheDocument();
    });

    it('does not show a minimum when unset', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ minQuantity: null }));

      renderDetailPage();

      await screen.findByText('Cordless drill');
      expect(screen.queryByText(/min/)).not.toBeInTheDocument();
    });

    it('tapping "Running low" calls the API and shows a confirmation toast', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
      const markMock = vi.spyOn(api, 'markRunningLow').mockResolvedValue({
        id: 'entry-1',
        itemId: 'item-1',
        status: 'open',
        source: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        item: {
          id: 'item-1',
          name: 'Cordless drill',
          quantity: 2,
          minQuantity: null,
          qrCode: 'qr-token-1',
          primaryPhoto: null,
          location: null,
        },
      });
      const user = userEvent.setup();

      renderDetailPage();

      await screen.findByText('Cordless drill');
      await user.click(screen.getByRole('button', { name: /running low/i }));

      await waitFor(() => expect(markMock).toHaveBeenCalledWith('item-1'));
      expect(await screen.findByText('Added to shopping list')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // "Verify count" affordance (EVT-27 AC 5)
  // =========================================================================

  describe('"Verify count" affordance (EVT-27)', () => {
    it('shows "Verify count" when the item is overdue', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(
        detail({
          countIntervalDays: 30,
          lastVerifiedAt: '2026-01-01T00:00:00.000Z', // long past due by "today" (frozen system clock)
        }),
      );

      renderDetailPage();

      expect(await screen.findByRole('button', { name: /verify count/i })).toBeInTheDocument();
    });

    it('hides "Verify count" when the item has no count schedule', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(
        detail({ countIntervalDays: null, lastVerifiedAt: null }),
      );

      renderDetailPage();

      await screen.findByText('Cordless drill');
      expect(screen.queryByRole('button', { name: /verify count/i })).not.toBeInTheDocument();
    });

    it('hides "Verify count" when the item is on schedule and not yet due', async () => {
      const justNow = new Date().toISOString();
      vi.spyOn(api, 'fetchItem').mockResolvedValue(
        detail({ countIntervalDays: 365, lastVerifiedAt: justNow }),
      );

      renderDetailPage();

      await screen.findByText('Cordless drill');
      expect(screen.queryByRole('button', { name: /verify count/i })).not.toBeInTheDocument();
    });

    it('tapping "Verify count" opens the blind CountDialog and records the count', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(
        detail({ countIntervalDays: 30, lastVerifiedAt: '2026-01-01T00:00:00.000Z' }),
      );
      const countMock = vi.spyOn(api, 'countItem').mockResolvedValue({
        item: detail(),
        bookQuantity: 2,
        countedQuantity: 4,
        delta: 2,
      });
      const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      const user = userEvent.setup();

      renderDetailPage();

      await user.click(await screen.findByRole('button', { name: /verify count/i }));
      expect(screen.getByText('How many are there?')).toBeInTheDocument();
      // Blind entry — book quantity must not be visible before submit.
      expect(screen.queryByText(/book quantity/i)).not.toBeInTheDocument();

      await user.type(screen.getByLabelText('Counted quantity'), '4');
      await user.click(screen.getByRole('button', { name: 'Submit count' }));

      expect(countMock).toHaveBeenCalledWith('item-1', 4);
      expect(await screen.findByText(/Book quantity was 2/)).toBeInTheDocument();
      // A count can clear (or newly trigger) an item's overdue
      // verification status, so VerificationPage's queue query must be
      // invalidated too — not just 'items' (mirrors VerificationPage's own
      // countMutation.onSuccess, which invalidates both keys).
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['items'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['verification-queue'] });
    });
  });

  // =========================================================================
  // "Use" (consume) + opportunistic verification prompt (EVT-27 AC 4)
  // =========================================================================

  describe('"Use" + opportunistic prompt (EVT-27)', () => {
    // EVT-38 finding #8 — the "Use" quantity field must show a numeric
    // keypad, not the full iOS keyboard.
    it('shows the numeric keypad on the "Use" dialog quantity field (EVT-38 AC1)', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ quantity: 10, minQuantity: null }));
      const user = userEvent.setup();

      renderDetailPage();

      await user.click(await screen.findByRole('button', { name: 'Use' }));
      const dialog = await screen.findByRole('dialog');
      const input = within(dialog).getByLabelText('Quantity');
      expect(input).toHaveAttribute('inputmode', 'numeric');
      expect(input).toHaveAttribute('pattern', '[0-9]*');
    });

    it('tapping "Use" records a consume movement for the entered quantity', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ quantity: 10, minQuantity: null }));
      const consumeMock = vi.spyOn(api, 'consumeItem').mockResolvedValue({
        item: detail({ quantity: 9 }),
        offerVerification: false,
      });
      const user = userEvent.setup();

      renderDetailPage();

      await user.click(await screen.findByRole('button', { name: 'Use' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Use' }));

      await waitFor(() => expect(consumeMock).toHaveBeenCalledWith('item-1', 1));
    });

    it('offers the opportunistic "how many are actually left?" prompt when the response says so', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ quantity: 3, minQuantity: null }));
      vi.spyOn(api, 'consumeItem').mockResolvedValue({
        item: detail({ quantity: 2 }),
        offerVerification: true,
      });
      const user = userEvent.setup();

      renderDetailPage();

      await user.click(await screen.findByRole('button', { name: 'Use' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Use' }));

      expect(await screen.findByText('How many are actually left?')).toBeInTheDocument();
    });

    it('does NOT offer the opportunistic prompt when the response says no', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ quantity: 10, minQuantity: null }));
      vi.spyOn(api, 'consumeItem').mockResolvedValue({
        item: detail({ quantity: 9 }),
        offerVerification: false,
      });
      const user = userEvent.setup();

      renderDetailPage();

      await user.click(await screen.findByRole('button', { name: 'Use' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Use' }));

      await waitFor(() => expect(api.consumeItem).toHaveBeenCalled());
      expect(screen.queryByText('How many are actually left?')).not.toBeInTheDocument();
    });

    it('"Skip" dismisses the opportunistic prompt in one tap without opening the count dialog', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ quantity: 3, minQuantity: null }));
      vi.spyOn(api, 'consumeItem').mockResolvedValue({
        item: detail({ quantity: 2 }),
        offerVerification: true,
      });
      const user = userEvent.setup();

      renderDetailPage();

      await user.click(await screen.findByRole('button', { name: 'Use' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Use' }));

      // `findByRole` (not `getByRole`) — the confirm dialog's exit
      // transition briefly leaves it aria-hidden-blocking role queries even
      // after its text has left the accessible tree; findByRole polls until
      // that settles.
      await user.click(await screen.findByRole('button', { name: 'Skip' }));

      // The Snackbar's own exit transition briefly leaves its text in the
      // DOM after the click — wait for it to actually leave, same reasoning
      // as the findByRole above.
      await waitFor(() =>
        expect(screen.queryByText('How many are actually left?')).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('How many are there?')).not.toBeInTheDocument();
    });

    it('"Count" on the opportunistic prompt opens the blind CountDialog', async () => {
      vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ quantity: 3, minQuantity: null }));
      vi.spyOn(api, 'consumeItem').mockResolvedValue({
        item: detail({ quantity: 2 }),
        offerVerification: true,
      });
      vi.spyOn(api, 'countItem').mockResolvedValue({
        item: detail({ quantity: 2 }),
        bookQuantity: 2,
        countedQuantity: 2,
        delta: 0,
      });
      const user = userEvent.setup();

      renderDetailPage();

      await user.click(await screen.findByRole('button', { name: 'Use' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Use' }));

      await user.click(await screen.findByRole('button', { name: 'Count' }));

      expect(screen.getByText('How many are there?')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText('How many are actually left?')).not.toBeInTheDocument(),
      );
    });
  });
});
