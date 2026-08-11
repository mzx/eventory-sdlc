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

function renderDetailPage(id = 'item-1', options: { state?: { justCreated?: boolean } } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: `/items/${id}`, state: options.state }]}>
        <Routes>
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/items/:id/edit" element={<div>edit page</div>} />
          <Route path="/items/:id/print" element={<div>print page</div>} />
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
});
