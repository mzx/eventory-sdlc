import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ItemPrintPage } from './ItemPrintPage';

const detail = (overrides: Partial<api.ItemDetail> = {}): api.ItemDetail => ({
  id: 'item-1',
  name: 'Cordless drill',
  description: 'Great for shelving',
  quantity: 2,
  unit: 'units',
  properties: { voltage: '18V' },
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
  photos: [{ id: 'photo-1', filename: 'primary.jpg', mimeType: 'image/jpeg' }],
  ...overrides,
});

function renderPrintPage(id = 'item-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/items/${id}/print`]}>
        <Routes>
          <Route path="/items/:id/print" element={<ItemPrintPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ItemPrintPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders only the QR sticker, the item name, and the print trigger — no detail chrome', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());

    renderPrintPage();

    expect(await screen.findByText('Cordless drill')).toBeInTheDocument();

    const qr = await screen.findByAltText('QR sticker');
    expect(qr).toHaveAttribute('src', expect.stringContaining('qr-token-1'));

    // None of the rest of the item-detail chrome should be present: no
    // description, no tags, no location/category, no properties table, and
    // no Edit/Delete actions.
    expect(screen.queryByText('Great for shelving')).not.toBeInTheDocument();
    expect(screen.queryByText('power-tools')).not.toBeInTheDocument();
    expect(screen.queryByText('Cabinet 3')).not.toBeInTheDocument();
    expect(screen.queryByText(/Category:/)).not.toBeInTheDocument();
    expect(screen.queryByText('voltage')).not.toBeInTheDocument();
    expect(screen.queryByText('18V')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Qty:/)).not.toBeInTheDocument();
  });

  it('shows the Print trigger button that calls window.print', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    renderPrintPage();

    const button = await screen.findByTestId('trigger-print');
    button.click();

    expect(printSpy).toHaveBeenCalled();
  });

  it('shows an error alert when the item fails to load', async () => {
    vi.spyOn(api, 'fetchItem').mockRejectedValue(new Error('Item not found'));

    renderPrintPage();

    expect(await screen.findByText('Item not found')).toBeInTheDocument();
  });
});
