import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ItemDetailPage } from './ItemDetailPage';

const detail = (overrides: Partial<api.ItemDetail> = {}): api.ItemDetail => ({
  id: 'item-1',
  name: 'Cordless drill',
  description: 'Great for shelving',
  quantity: 2,
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

function renderDetailPage(id = 'item-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/items/${id}`]}>
        <Routes>
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/" element={<div>items list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ItemDetailPage', () => {
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

  it('renders the QR sticker image using the item qrCode', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

    renderDetailPage();

    const qr = await screen.findByAltText('QR code');
    expect(qr).toHaveAttribute('src', expect.stringContaining('qr-token-1'));
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
});
