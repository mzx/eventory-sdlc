import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { setActiveWorkspaceId } from '../api';
import { expectAllQueryKeysScopedToWorkspace } from '../test/queryKeyAssertions';
import { setActiveWorkspaceRole } from '../workspace/useActiveWorkspace';
import { ItemsPage } from './ItemsPage';

const item = (overrides: Partial<api.ItemListRow> = {}): api.ItemListRow => ({
  id: 'item-1',
  name: 'Cordless drill',
  description: null,
  quantity: 1,
  minQuantity: null,
  unit: null,
  properties: {},
  qrCode: 'qr-1',
  locationId: null,
  categoryId: null,
  primaryPhotoId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  location: null,
  primaryPhoto: null,
  ...overrides,
});

function renderItemsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ItemsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('ItemsPage', () => {
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchTags').mockResolvedValue([
      { id: 'tag-1', name: 'power-tools', color: null, itemCount: 1 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the items returned by the list query', async () => {
    vi.spyOn(api, 'fetchItems').mockResolvedValue([
      item({ id: 'item-1', name: 'Cordless drill' }),
      item({ id: 'item-2', name: 'Torque wrench' }),
    ]);

    renderItemsPage();

    expect(await screen.findByText('Cordless drill')).toBeInTheDocument();
    expect(screen.getByText('Torque wrench')).toBeInTheDocument();
    expect(screen.getAllByTestId('item-card')).toHaveLength(2);
  });

  it('debounces the search box and refetches with ?search=', async () => {
    const fetchItemsMock = vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
    const user = userEvent.setup();

    renderItemsPage();

    await waitFor(() => expect(fetchItemsMock).toHaveBeenCalledWith({}));

    const searchBox = screen.getByRole('textbox', { name: /search items/i });
    await user.type(searchBox, 'drill');

    await waitFor(() =>
      expect(fetchItemsMock).toHaveBeenLastCalledWith({ search: 'drill', tag: undefined }),
    );
  });

  it('shows an empty state when there are no items and no filters', async () => {
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);

    renderItemsPage();

    expect(await screen.findByText('No items yet')).toBeInTheDocument();
  });

  // =========================================================================
  // "Clear filters" chip (EVT-23)
  // =========================================================================

  describe('clear filters chip', () => {
    it('is absent when no filter is active', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);

      renderItemsPage();

      await screen.findByText('power-tools (1)');
      expect(screen.queryByText('Clear filters')).not.toBeInTheDocument();
    });

    it('AC1: renders as the first chip in the row, before all tag chips, once a tag filter is active', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
      const user = userEvent.setup();

      renderItemsPage();

      const tagChip = await screen.findByText('power-tools (1)');
      await user.click(tagChip);

      const clearChip = await screen.findByText('Clear filters');
      const row = clearChip.closest('div[class*="MuiStack-root"]');
      expect(row).not.toBeNull();
      const chipLabels = Array.from(row!.querySelectorAll('.MuiChip-label')).map(
        (el) => el.textContent,
      );
      expect(chipLabels[0]).toBe('Clear filters');
      expect(chipLabels).toContain('power-tools (1)');
    });

    it('AC1: renders as the first chip in the row once a text search is active', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
      const user = userEvent.setup();

      renderItemsPage();

      await screen.findByText('power-tools (1)');
      const searchBox = screen.getByRole('textbox', { name: /search items/i });
      await user.type(searchBox, 'drill');

      const clearChip = await screen.findByText('Clear filters');
      const row = clearChip.closest('div[class*="MuiStack-root"]');
      const chipLabels = Array.from(row!.querySelectorAll('.MuiChip-label')).map(
        (el) => el.textContent,
      );
      expect(chipLabels[0]).toBe('Clear filters');
    });

    it('AC2: renders an X icon and a color/variant combination no tag chip uses', async () => {
      vi.spyOn(api, 'fetchTags').mockResolvedValue([
        { id: 'tag-1', name: 'power-tools', color: null, itemCount: 1 },
        { id: 'tag-2', name: 'hardware', color: null, itemCount: 2 },
      ]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
      const user = userEvent.setup();

      renderItemsPage();

      const tagChip = await screen.findByText('power-tools (1)');
      await user.click(tagChip);

      const clearChip = (await screen.findByText('Clear filters')).closest('.MuiChip-root');
      expect(clearChip).not.toBeNull();
      expect(clearChip!.querySelector('svg')).toBeInTheDocument();
      expect(clearChip).toHaveClass('MuiChip-colorError');
      expect(clearChip).toHaveClass('MuiChip-outlinedError');

      // Sanity check: neither tag-chip state — selected (primary/filled) nor
      // unselected (default/outlined) — overlaps with the clear chip's
      // color/variant (error/outlined is unused by any tag state).
      const selectedTagChip = screen.getByText('power-tools (1)').closest('.MuiChip-root');
      expect(selectedTagChip).not.toHaveClass('MuiChip-colorError');

      const unselectedTagChip = screen.getByText('hardware (2)').closest('.MuiChip-root');
      expect(unselectedTagChip).not.toHaveClass('MuiChip-colorError');
    });

    it('AC4: tag chip styling is unchanged — selected is primary/filled, unselected is default/outlined, count labels intact', async () => {
      vi.spyOn(api, 'fetchTags').mockResolvedValue([
        { id: 'tag-1', name: 'power-tools', color: null, itemCount: 1 },
        { id: 'tag-2', name: 'hardware', color: null, itemCount: 2 },
      ]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
      const user = userEvent.setup();

      renderItemsPage();

      const tagChip = await screen.findByText('power-tools (1)');
      await user.click(tagChip);

      const selectedTagChip = screen.getByText('power-tools (1)').closest('.MuiChip-root');
      expect(selectedTagChip).toHaveClass('MuiChip-colorPrimary');
      expect(selectedTagChip).toHaveClass('MuiChip-filled');

      const unselectedTagChip = screen.getByText('hardware (2)').closest('.MuiChip-root');
      expect(unselectedTagChip).toHaveClass('MuiChip-colorDefault');
      expect(unselectedTagChip).toHaveClass('MuiChip-outlined');
    });

    it('AC1: renders the clear chip (with no tag chips) when the workspace has zero tags and a text search is active', async () => {
      vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
      const user = userEvent.setup();

      renderItemsPage();

      const searchBox = screen.getByRole('textbox', { name: /search items/i });
      await user.type(searchBox, 'drill');

      const clearChip = await screen.findByText('Clear filters');
      const row = clearChip.closest('div[class*="MuiStack-root"]');
      expect(row).not.toBeNull();
      const chips = row!.querySelectorAll('.MuiChip-root');
      expect(chips).toHaveLength(1);
    });

    it('AC3: clicking it clears both the text search and the active tag', async () => {
      const fetchItemsMock = vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
      const user = userEvent.setup();

      renderItemsPage();

      const tagChip = await screen.findByText('power-tools (1)');
      await user.click(tagChip);

      const searchBox = screen.getByRole('textbox', { name: /search items/i });
      await user.type(searchBox, 'drill');

      await waitFor(() =>
        expect(fetchItemsMock).toHaveBeenLastCalledWith({ search: 'drill', tag: 'power-tools' }),
      );

      const clearChip = await screen.findByText('Clear filters');
      await user.click(clearChip);

      expect(searchBox).toHaveValue('');
      await waitFor(() => expect(fetchItemsMock).toHaveBeenLastCalledWith({}));
      expect(screen.queryByText('Clear filters')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Photo search (EVT-17)
  // =========================================================================

  describe('search by photo', () => {
    const photoFile = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });

    function analysis(overrides: Partial<api.PhotoSearchAnalysis> = {}): api.PhotoSearchAnalysis {
      return {
        suggested_name: 'M4 hex bolt',
        description: '',
        tags: [],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: [],
        ...overrides,
      };
    }

    it('AC3: replaces the grid with matches and shows the "Looks like" banner', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([
        item({ id: 'item-1', name: 'Cordless drill' }),
      ]);
      const searchByPhotoMock = vi.spyOn(api, 'searchItemsByPhoto').mockResolvedValue({
        analysis: analysis({ suggested_name: 'M4 hex bolt' }),
        matches: [item({ id: 'item-2', name: 'M4 Hex Bolt (pack of 50)' })],
      });

      renderItemsPage();

      // Normal browsing shows the seeded item first
      expect(await screen.findByText('Cordless drill')).toBeInTheDocument();

      const fileInput = screen.getByTestId('photo-search-input');
      await userEvent.upload(fileInput, photoFile);

      expect(searchByPhotoMock).toHaveBeenCalledWith(photoFile, expect.anything());

      // Banner echoes the analysis
      expect(await screen.findByText(/Looks like: M4 hex bolt/)).toBeInTheDocument();

      // Grid now shows the photo-search matches instead of normal browsing
      expect(screen.getByText('M4 Hex Bolt (pack of 50)')).toBeInTheDocument();
      expect(screen.queryByText('Cordless drill')).not.toBeInTheDocument();
    });

    it('AC3: shows a no-matches message when the photo search finds nothing, with the banner still visible', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
      vi.spyOn(api, 'searchItemsByPhoto').mockResolvedValue({
        analysis: analysis({ suggested_name: 'Exotic gadget' }),
        matches: [],
      });

      renderItemsPage();
      await screen.findByTestId('item-card');

      const fileInput = screen.getByTestId('photo-search-input');
      await userEvent.upload(fileInput, photoFile);

      expect(await screen.findByText(/Looks like: Exotic gadget/)).toBeInTheDocument();
      expect(screen.getByText('No matching items found for this photo.')).toBeInTheDocument();
    });

    it('AC3: clearing the photo search restores normal browsing', async () => {
      const fetchItemsMock = vi
        .spyOn(api, 'fetchItems')
        .mockResolvedValue([item({ id: 'item-1', name: 'Cordless drill' })]);
      vi.spyOn(api, 'searchItemsByPhoto').mockResolvedValue({
        analysis: analysis({ suggested_name: 'M4 hex bolt' }),
        matches: [item({ id: 'item-2', name: 'M4 Hex Bolt (pack of 50)' })],
      });

      renderItemsPage();
      await screen.findByText('Cordless drill');

      const fileInput = screen.getByTestId('photo-search-input');
      await userEvent.upload(fileInput, photoFile);
      await screen.findByText(/Looks like: M4 hex bolt/);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /clear search/i }));

      // Banner is gone and normal browsing (original items query) is restored
      expect(screen.queryByText(/Looks like:/)).not.toBeInTheDocument();
      expect(await screen.findByText('Cordless drill')).toBeInTheDocument();
      expect(screen.queryByText('M4 Hex Bolt (pack of 50)')).not.toBeInTheDocument();
      expect(fetchItemsMock).toHaveBeenCalled();
    });

    it('shows an error alert when the photo search request fails', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      vi.spyOn(api, 'searchItemsByPhoto').mockRejectedValue(new Error('boom'));

      renderItemsPage();

      const fileInput = screen.getByTestId('photo-search-input');
      await userEvent.upload(fileInput, photoFile);

      expect(await screen.findByText('boom')).toBeInTheDocument();
    });

    // -----------------------------------------------------------------------
    // Review round 2, finding 2 — new text input clears a stale photo search
    // -----------------------------------------------------------------------

    it('typing in the text search while photo results are shown clears the photo search and returns to normal browsing', async () => {
      const fetchItemsMock = vi
        .spyOn(api, 'fetchItems')
        .mockResolvedValue([item({ id: 'item-1', name: 'Cordless drill' })]);
      vi.spyOn(api, 'searchItemsByPhoto').mockResolvedValue({
        analysis: analysis({ suggested_name: 'M4 hex bolt' }),
        matches: [item({ id: 'item-2', name: 'M4 Hex Bolt (pack of 50)' })],
      });

      renderItemsPage();
      await screen.findByText('Cordless drill');

      const fileInput = screen.getByTestId('photo-search-input');
      await userEvent.upload(fileInput, photoFile);
      await screen.findByText(/Looks like: M4 hex bolt/);
      expect(screen.getByText('M4 Hex Bolt (pack of 50)')).toBeInTheDocument();

      const searchBox = screen.getByRole('textbox', { name: /search items/i });
      await userEvent.type(searchBox, 'drill');

      // Photo search banner and matches are gone; the grid returns to
      // normal browsing (itemsQuery refetches with the new ?search=).
      await waitFor(() => expect(screen.queryByText(/Looks like:/)).not.toBeInTheDocument());
      expect(screen.queryByText('M4 Hex Bolt (pack of 50)')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(fetchItemsMock).toHaveBeenLastCalledWith({ search: 'drill', tag: undefined }),
      );
    });

    it('submitting a photo search while a text filter is active overrides the grid with photo matches', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([
        item({ id: 'item-1', name: 'Cordless drill' }),
      ]);
      const searchByPhotoMock = vi.spyOn(api, 'searchItemsByPhoto').mockResolvedValue({
        analysis: analysis({ suggested_name: 'M4 hex bolt' }),
        matches: [item({ id: 'item-2', name: 'M4 Hex Bolt (pack of 50)' })],
      });

      renderItemsPage();
      await screen.findByText('Cordless drill');

      const searchBox = screen.getByRole('textbox', { name: /search items/i });
      await userEvent.type(searchBox, 'drill');

      const fileInput = screen.getByTestId('photo-search-input');
      await userEvent.upload(fileInput, photoFile);

      expect(searchByPhotoMock).toHaveBeenCalledWith(photoFile, expect.anything());
      expect(await screen.findByText(/Looks like: M4 hex bolt/)).toBeInTheDocument();
      expect(screen.getByText('M4 Hex Bolt (pack of 50)')).toBeInTheDocument();
      expect(screen.queryByText('Cordless drill')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Workspace scoping (EVT-43 AC1/AC2)
  // =========================================================================

  describe('workspace scoping', () => {
    it('AC1: every cached query key carries the active workspace id', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);

      const { queryClient } = renderItemsPage();
      await screen.findByTestId('item-card');

      expectAllQueryKeysScopedToWorkspace(queryClient, 'ws-1');
    });

    it('AC2: switching workspaces swaps the item grid with no stale flash', async () => {
      vi.spyOn(api, 'fetchItems').mockImplementation(async () => {
        return api.getActiveWorkspaceId() === 'ws-1'
          ? [item({ id: 'item-1', name: 'Cordless drill' })]
          : [item({ id: 'item-2', name: 'Bandsaw blade' })];
      });

      renderItemsPage();
      expect(await screen.findByText('Cordless drill')).toBeInTheDocument();

      setActiveWorkspaceId('ws-2');

      // The other workspace's item appears and the first workspace's item
      // never re-renders in between (no stale-cache flash) — a brand-new
      // queryKey has no prior cache entry to show while refetching.
      expect(await screen.findByText('Bandsaw blade')).toBeInTheDocument();
      expect(screen.queryByText('Cordless drill')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Viewer-aware UI (EVT-43 AC6)
  // =========================================================================

  describe('viewer role', () => {
    it('hides the "Add item" empty-state link for a viewer, shown for a member', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      setActiveWorkspaceRole('viewer');

      renderItemsPage();

      await screen.findByText('No items yet');
      expect(screen.queryByRole('link', { name: /add item/i })).not.toBeInTheDocument();
      expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
    });

    it('shows the "Add item" empty-state link for a member', async () => {
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      setActiveWorkspaceRole('member');

      renderItemsPage();

      await screen.findByText('No items yet');
      expect(screen.getByRole('link', { name: /add item/i })).toBeInTheDocument();
    });
  });
});
