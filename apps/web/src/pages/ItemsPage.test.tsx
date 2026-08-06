import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ItemsPage } from './ItemsPage';

const item = (overrides: Partial<api.ItemListRow> = {}): api.ItemListRow => ({
  id: 'item-1',
  name: 'Cordless drill',
  description: null,
  quantity: 1,
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ItemsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ItemsPage', () => {
  beforeEach(() => {
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
  });
});
