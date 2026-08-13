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
    kind: 'area',
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
    kind: 'area',
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
    minQuantity: null,
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

  // EVT-30 AC 1/5: container child cards show the distinct icon.
  it('renders a distinct icon for a container child vs. an area child', async () => {
    vi.spyOn(api, 'fetchLocation').mockResolvedValue(
      locationDetail({
        children: [
          { id: 'shelf-4', name: 'Shelf 4', path: 'garage.shelf-3.shelf-4', kind: 'area' },
          { id: 'box-1', name: 'Tote Box', path: 'garage.shelf-3.box-1', kind: 'container' },
        ],
      }),
    );
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);

    renderLocationDetailPage();

    const areaCard = (await screen.findByText('Shelf 4')).closest(
      '[data-testid="location-child-card"]',
    ) as HTMLElement;
    const containerCard = screen
      .getByText('Tote Box')
      .closest('[data-testid="location-child-card"]') as HTMLElement;

    expect(areaCard.querySelector('[aria-label="Area"]')).not.toBeNull();
    expect(containerCard.querySelector('[aria-label="Container"]')).not.toBeNull();
  });

  // EVT-30 AC 2: containers offer "Move to…"; areas do not.
  describe('container "Move to…" flow', () => {
    it('shows "Move to…" only for a container location, not an area', async () => {
      vi.spyOn(api, 'fetchLocation').mockResolvedValue(locationDetail({ kind: 'area' }));
      vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);

      renderLocationDetailPage();

      await screen.findByRole('heading', { name: 'Shelf 3' });
      expect(screen.queryByRole('button', { name: 'Move to…' })).not.toBeInTheDocument();
    });

    it('opens a destination picker excluding the container itself and its descendants, and moves on confirm', async () => {
      vi.spyOn(api, 'fetchLocation').mockResolvedValue(
        locationDetail({ id: 'box-1', path: 'garage.box-1', kind: 'container' }),
      );
      vi.spyOn(api, 'fetchLocations').mockResolvedValue([
        locListItem({ id: 'garage', name: 'Garage', path: 'garage' }),
        locListItem({ id: 'box-1', name: 'Tote Box', path: 'garage.box-1', kind: 'container' }),
        locListItem({
          id: 'box-1-inner',
          name: 'Inner Box',
          path: 'garage.box-1.inner',
          kind: 'container',
        }),
        locListItem({ id: 'shelf-2', name: 'Shelf 2', path: 'garage.shelf-2' }),
      ]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      vi.spyOn(api, 'fetchContainerMovements').mockResolvedValue({
        data: [],
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      });
      const moveLocationMock = vi
        .spyOn(api, 'moveLocation')
        .mockResolvedValue(
          locationDetail({ id: 'box-1', path: 'garage.shelf-2.box-1', kind: 'container' }),
        );

      renderLocationDetailPage('box-1');
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Move to…' }));

      // Neither the container itself nor its descendant is offered as a destination.
      expect(screen.queryByRole('option', { name: 'Tote Box' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Inner Box' })).not.toBeInTheDocument();

      await user.click(screen.getByLabelText('Destination'));
      await user.click(await screen.findByRole('option', { name: 'Shelf 2' }));
      await user.click(screen.getByRole('button', { name: 'Move' }));

      await waitFor(() => expect(moveLocationMock).toHaveBeenCalledWith('box-1', 'shelf-2'));
    });

    it('shows a "No location (root)" option and passes null when selected', async () => {
      vi.spyOn(api, 'fetchLocation').mockResolvedValue(
        locationDetail({
          id: 'box-1',
          path: 'garage.box-1',
          parentId: 'garage',
          kind: 'container',
        }),
      );
      vi.spyOn(api, 'fetchLocations').mockResolvedValue([
        locListItem({ id: 'garage', name: 'Garage', path: 'garage' }),
        locListItem({ id: 'box-1', name: 'Tote Box', path: 'garage.box-1', kind: 'container' }),
      ]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      vi.spyOn(api, 'fetchContainerMovements').mockResolvedValue({
        data: [],
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      });
      const moveLocationMock = vi
        .spyOn(api, 'moveLocation')
        .mockResolvedValue(
          locationDetail({ id: 'box-1', path: 'box-1', parentId: null, kind: 'container' }),
        );

      renderLocationDetailPage('box-1');
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Move to…' }));
      await user.click(screen.getByLabelText('Destination'));
      await user.click(await screen.findByRole('option', { name: 'No location (root)' }));
      await user.click(screen.getByRole('button', { name: 'Move' }));

      await waitFor(() => expect(moveLocationMock).toHaveBeenCalledWith('box-1', null));
    });

    it('shows a server error message in the dialog when the move is rejected', async () => {
      vi.spyOn(api, 'fetchLocation').mockResolvedValue(
        locationDetail({ id: 'box-1', path: 'garage.box-1', kind: 'container' }),
      );
      vi.spyOn(api, 'fetchLocations').mockResolvedValue([
        locListItem({ id: 'garage', name: 'Garage', path: 'garage' }),
        locListItem({ id: 'box-1', name: 'Tote Box', path: 'garage.box-1', kind: 'container' }),
      ]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      vi.spyOn(api, 'fetchContainerMovements').mockResolvedValue({
        data: [],
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      });
      vi.spyOn(api, 'moveLocation').mockRejectedValue(
        new Error('Request to /locations/box-1/move failed with status 422'),
      );

      renderLocationDetailPage('box-1');
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Move to…' }));
      await user.click(screen.getByRole('button', { name: 'Move' }));

      expect(
        await screen.findByText('Request to /locations/box-1/move failed with status 422'),
      ).toBeInTheDocument();
    });
  });

  // EVT-30 AC 3: a container's own move history is visible, without per-item spam.
  describe('container move history', () => {
    it('renders the container move history when the location is a container', async () => {
      vi.spyOn(api, 'fetchLocation').mockResolvedValue(
        locationDetail({ id: 'box-1', path: 'garage.box-1', kind: 'container' }),
      );
      vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      vi.spyOn(api, 'fetchContainerMovements').mockResolvedValue({
        data: [
          {
            id: 'mv-1',
            containerId: 'box-1',
            kind: 'move',
            delta: 0,
            fromLocationId: 'garage',
            toLocationId: 'shelf-2',
            note: null,
            createdById: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            fromLocation: { id: 'garage', name: 'Garage', path: 'garage' },
            toLocation: { id: 'shelf-2', name: 'Shelf 2', path: 'garage.shelf-2' },
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });

      renderLocationDetailPage('box-1');

      expect(await screen.findByText('Moved — Garage → Shelf 2')).toBeInTheDocument();
    });

    it('does not render a move-history section for an area location', async () => {
      vi.spyOn(api, 'fetchLocation').mockResolvedValue(locationDetail({ kind: 'area' }));
      vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      const fetchContainerMovementsMock = vi.spyOn(api, 'fetchContainerMovements');

      renderLocationDetailPage();

      await screen.findByRole('heading', { name: 'Shelf 3' });
      expect(screen.queryByText('Move history')).not.toBeInTheDocument();
      expect(fetchContainerMovementsMock).not.toHaveBeenCalled();
    });

    it('shows an empty state when the container has no recorded moves', async () => {
      vi.spyOn(api, 'fetchLocation').mockResolvedValue(
        locationDetail({ id: 'box-1', path: 'garage.box-1', kind: 'container' }),
      );
      vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      vi.spyOn(api, 'fetchContainerMovements').mockResolvedValue({
        data: [],
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      });

      renderLocationDetailPage('box-1');

      expect(await screen.findByText('No moves recorded yet.')).toBeInTheDocument();
    });
  });
});
