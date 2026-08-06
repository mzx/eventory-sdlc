import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { LocationDetailPage } from './LocationDetailPage';

function locationDetail(overrides: Partial<api.LocationDetail> = {}): api.LocationDetail {
  return {
    id: 'shelf-3',
    name: 'Shelf 3',
    path: 'garage.shelf-3',
    parentId: 'garage',
    notes: null,
    qrCode: 'qr-shelf-3',
    children: [],
    items: [],
    breadcrumb: [
      { segment: 'garage', path: 'garage' },
      { segment: 'shelf-3', path: 'garage.shelf-3' },
    ],
    ...overrides,
  };
}

function locListItem(overrides: Partial<api.LocationListItem> = {}): api.LocationListItem {
  return {
    id: 'garage',
    name: 'Garage',
    path: 'garage',
    parentId: null,
    qrCode: 'qr-garage',
    itemCount: 1,
    ...overrides,
  };
}

function item(overrides: Partial<api.ItemListRow> = {}): api.ItemListRow {
  return {
    id: 'item-1',
    name: 'Cordless drill',
    description: null,
    quantity: 1,
    unit: null,
    properties: {},
    qrCode: 'qr-item-1',
    locationId: 'shelf-3',
    categoryId: null,
    primaryPhotoId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    location: null,
    primaryPhoto: null,
    ...overrides,
  };
}

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="current-location">{location.pathname + location.search}</div>;
}

function renderLocationDetailPage(id = 'shelf-3') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/locations/${id}`]}>
        <Routes>
          <Route path="/locations/:id" element={<LocationDetailPage />} />
          <Route path="/intake" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LocationDetailPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows breadcrumb, children, and items; "Add item here" links into intake with the location', async () => {
    vi.spyOn(api, 'fetchLocation').mockResolvedValue(
      locationDetail({
        children: [{ id: 'bin-1', name: 'Bin 1', path: 'garage.shelf-3.bin-1' }],
      }),
    );
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      locListItem({ id: 'garage', path: 'garage' }),
      locListItem({ id: 'shelf-3', path: 'garage.shelf-3', parentId: 'garage', itemCount: 3 }),
      locListItem({ id: 'bin-1', path: 'garage.shelf-3.bin-1', parentId: 'shelf-3', itemCount: 0 }),
    ]);
    vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);

    renderLocationDetailPage();

    expect(await screen.findByRole('heading', { name: 'Shelf 3' })).toBeInTheDocument();
    expect(screen.getByText('garage')).toBeInTheDocument();
    expect(screen.getByText('Bin 1')).toBeInTheDocument();
    expect(await screen.findByText('Cordless drill')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add item here' }));

    expect(await screen.findByTestId('current-location')).toHaveTextContent(
      '/intake?locationId=shelf-3',
    );
  });

  it('shows an empty state when there are no direct items', async () => {
    vi.spyOn(api, 'fetchLocation').mockResolvedValue(locationDetail());
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);

    renderLocationDetailPage();

    expect(
      await screen.findByText('No items placed directly in this location yet.'),
    ).toBeInTheDocument();
  });

  it('renders a print-ready QR sticker showing the location path', async () => {
    vi.spyOn(api, 'fetchLocation').mockResolvedValue(locationDetail());
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);

    // Real (jsdom) sub-document, so the DOM-building `handlePrint` in
    // QrThumb has an actual `document`/`body` to append to.
    const printSpy = vi.fn();
    const popupDocument = document.implementation.createHTMLDocument('');
    const fakeWindow = {
      document: popupDocument,
      print: printSpy,
      opener: window,
      onload: null as (() => void) | null,
    };
    vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);

    renderLocationDetailPage();

    expect(await screen.findByTestId('qr-thumb')).toBeInTheDocument();
    expect(screen.getByText('garage › shelf-3')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Print sticker' }));

    await waitFor(() => expect(fakeWindow.opener).toBeNull());
    expect(popupDocument.title).toBe('garage › shelf-3');
    expect(popupDocument.querySelector('img')?.getAttribute('src')).toContain('qr-shelf-3');
    expect(popupDocument.body.textContent).toContain('garage › shelf-3');

    fakeWindow.onload?.();
    expect(printSpy).toHaveBeenCalled();
  });
});
