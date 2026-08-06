import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { EditItemPage } from './EditItemPage';

const detail = (overrides: Partial<api.ItemDetail> = {}): api.ItemDetail => ({
  id: 'item-1',
  name: 'Cordless drill',
  description: 'Great for shelving',
  quantity: 2,
  unit: 'units',
  properties: { voltage: '18V' },
  qrCode: 'qr-token-1',
  locationId: null,
  categoryId: null,
  primaryPhotoId: 'photo-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tags: [
    { itemId: 'item-1', tagId: 'tag-1', tag: { id: 'tag-1', name: 'power-tools', color: null } },
  ],
  location: null,
  category: null,
  primaryPhoto: { id: 'photo-1', filename: 'primary.jpg', mimeType: 'image/jpeg' },
  photos: [{ id: 'photo-1', filename: 'primary.jpg', mimeType: 'image/jpeg' }],
  ...overrides,
});

function renderEditPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/items/item-1/edit']}>
        <Routes>
          <Route path="/items/:id/edit" element={<EditItemPage />} />
          <Route path="/items/:id" element={<div>detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EditItemPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds the form from the loaded item and saves edits via PATCH', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    vi.spyOn(api, 'fetchTags').mockResolvedValue([
      { id: 'tag-1', name: 'power-tools', color: null, itemCount: 1 },
    ]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      { id: 'loc-1', name: 'Garage', path: 'garage', parentId: null, qrCode: 'q1', itemCount: 3 },
    ]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([
      { id: 'cat-1', name: 'Hand tools', path: 'hand-tools', parentId: null },
    ]);
    const updateMock = vi
      .spyOn(api, 'updateItem')
      .mockResolvedValue(detail({ name: 'Impact driver' }));
    const user = userEvent.setup();

    renderEditPage();

    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toHaveValue('Cordless drill');

    await user.clear(nameInput);
    await user.type(nameInput, 'Impact driver');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ name: 'Impact driver', tags: ['power-tools'] }),
      ),
    );
    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('uploads a new photo linked to the item', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    const uploadMock = vi.spyOn(api, 'uploadPhoto').mockResolvedValue({
      id: 'photo-2',
      filename: 'second.jpg',
      mimeType: 'image/jpeg',
      url: '/storage/second.jpg',
    });
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    const file = new File(['bytes'], 'second.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(file, 'item-1'));
  });

  it('sets a photo as primary via PATCH photoIds', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(
      detail({
        primaryPhotoId: 'photo-1',
        photos: [
          { id: 'photo-1', filename: 'primary.jpg', mimeType: 'image/jpeg' },
          { id: 'photo-2', filename: 'second.jpg', mimeType: 'image/jpeg' },
        ],
      }),
    );
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    const updateMock = vi.spyOn(api, 'updateItem').mockResolvedValue(detail());
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: 'Set as primary photo' }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('item-1', { photoIds: ['photo-2'] }),
    );
  });
});
