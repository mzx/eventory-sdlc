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
});
