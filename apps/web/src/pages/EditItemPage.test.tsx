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

function renderEditPage(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
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

    // The input can render before the async item fetch seeds the form —
    // await the seeded value instead of asserting it synchronously.
    const nameInput = await screen.findByLabelText('Name');
    await waitFor(() => expect(nameInput).toHaveValue('Cordless drill'), { timeout: 10_000 });

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

  // ---------------------------------------------------------------------------
  // EVT-24 AC4/AC5: an upload on the edit page must invalidate the items LIST
  // query too (not just item detail), so the list's thumbnail reflects a
  // freshly auto-promoted primary photo without a full reload.
  // ---------------------------------------------------------------------------

  it('invalidates the items list query (not just item detail) after a successful upload', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    vi.spyOn(api, 'uploadPhoto').mockResolvedValue({
      id: 'photo-2',
      filename: 'second.jpg',
      mimeType: 'image/jpeg',
      url: '/storage/second.jpg',
    });
    const user = userEvent.setup();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed the same list query key ItemsPage uses, as if the list had
    // already been visited and cached before navigating to the edit page.
    const listQueryKey = ['items', { search: '', tag: null }];
    queryClient.setQueryData(listQueryKey, []);

    renderEditPage(queryClient);
    await screen.findByLabelText('Name');

    expect(queryClient.getQueryState(listQueryKey)?.isInvalidated).toBe(false);

    const file = new File(['bytes'], 'second.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(queryClient.getQueryState(listQueryKey)?.isInvalidated).toBe(true));
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

  it('removes a photo via the Remove photo button', async () => {
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
    const removeMock = vi.spyOn(api, 'deletePhoto').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    const removeButtons = screen.getAllByRole('button', { name: 'Remove photo' });
    await user.click(removeButtons[0]);

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('photo-1'));
  });

  it('adds, edits, and removes a properties row and saves the resulting payload', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ properties: { voltage: '18V' } }));
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    const updateMock = vi.spyOn(api, 'updateItem').mockResolvedValue(detail());
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    // Edit the existing "voltage" row's value.
    const valueInputs = screen.getAllByLabelText('Value');
    await user.clear(valueInputs[0]);
    await user.type(valueInputs[0], '20V');

    // Add a new row and fill it in.
    await user.click(screen.getByRole('button', { name: /add property/i }));
    const keyInputs = screen.getAllByLabelText('Key');
    const newKeyInput = keyInputs[keyInputs.length - 1];
    await user.type(newKeyInput, 'color');
    const newValueInputs = screen.getAllByLabelText('Value');
    await user.type(newValueInputs[newValueInputs.length - 1], 'yellow');

    // Now remove the newly-added "color" row before saving, so the payload
    // reflects an add followed by a remove.
    await user.click(screen.getByRole('button', { name: 'Remove property color' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ properties: { voltage: '20V' } }),
      ),
    );
  });

  it('changes the location via the Select and saves the resulting payload', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail({ locationId: null, location: null }));
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      { id: 'loc-1', name: 'Garage', path: 'garage', parentId: null, qrCode: 'q1', itemCount: 3 },
      {
        id: 'loc-2',
        name: 'Cabinet 3',
        path: 'garage.cabinet-3',
        parentId: 'loc-1',
        qrCode: 'q2',
        itemCount: 1,
      },
    ]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    const updateMock = vi.spyOn(api, 'updateItem').mockResolvedValue(detail());
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    await user.click(screen.getByLabelText('Location'));
    await user.click(await screen.findByRole('option', { name: 'Cabinet 3' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ locationId: 'loc-2' }),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // Round-3 review fix: clearing location/category must send explicit `null`,
  // not omit the key (which the server treats as "leave unchanged").
  // ---------------------------------------------------------------------------

  it('selecting "No location" sends explicit locationId: null in the PATCH payload', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(
      detail({
        locationId: 'loc-1',
        location: { id: 'loc-1', name: 'Garage', path: 'garage' },
      }),
    );
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      { id: 'loc-1', name: 'Garage', path: 'garage', parentId: null, qrCode: 'q1', itemCount: 3 },
    ]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    const updateMock = vi.spyOn(api, 'updateItem').mockResolvedValue(detail());
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    await user.click(screen.getByLabelText('Location'));
    await user.click(await screen.findByRole('option', { name: 'No location' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ locationId: null }),
      ),
    );
  });

  it('selecting "No category" sends explicit categoryId: null in the PATCH payload', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(
      detail({
        categoryId: 'cat-1',
        category: { id: 'cat-1', name: 'Hand tools', path: 'hand-tools' },
      }),
    );
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([
      { id: 'cat-1', name: 'Hand tools', path: 'hand-tools', parentId: null },
    ]);
    const updateMock = vi.spyOn(api, 'updateItem').mockResolvedValue(detail());
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    await user.click(screen.getByLabelText('Category'));
    await user.click(await screen.findByRole('option', { name: 'No category' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ categoryId: null }),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // Round-3 review fix: photo-action mutations must surface errors, not fail
  // silently.
  // ---------------------------------------------------------------------------

  it('shows an error alert when uploading a photo fails', async () => {
    vi.spyOn(api, 'fetchItem').mockResolvedValue(detail());
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    vi.spyOn(api, 'uploadPhoto').mockRejectedValue(new Error('Upload failed: file too large'));
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    const file = new File(['bytes'], 'second.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText('Upload failed: file too large')).toBeInTheDocument();
  });

  it('shows an error alert when setting a photo as primary fails', async () => {
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
    vi.spyOn(api, 'updateItem').mockRejectedValue(new Error('Failed to set primary photo'));
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: 'Set as primary photo' }));

    expect(await screen.findByText('Failed to set primary photo')).toBeInTheDocument();
  });

  it('shows an error alert when removing a photo fails', async () => {
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
    vi.spyOn(api, 'deletePhoto').mockRejectedValue(new Error('Failed to remove photo'));
    const user = userEvent.setup();

    renderEditPage();
    await screen.findByLabelText('Name');

    const removeButtons = screen.getAllByRole('button', { name: 'Remove photo' });
    await user.click(removeButtons[0]);

    expect(await screen.findByText('Failed to remove photo')).toBeInTheDocument();
  });
});
