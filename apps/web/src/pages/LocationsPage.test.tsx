import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { LocationsPage } from './LocationsPage';

function loc(overrides: Partial<api.LocationListItem> = {}): api.LocationListItem {
  return {
    id: 'garage',
    name: 'Garage',
    path: 'garage',
    parentId: null,
    qrCode: 'qr-garage',
    itemCount: 2,
    ...overrides,
  };
}

function renderLocationsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LocationsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a seeded tree nested with counts, and expand/collapse toggles children', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      loc({ id: 'garage', name: 'Garage', path: 'garage', parentId: null, itemCount: 5 }),
      loc({
        id: 'shelf-3',
        name: 'Shelf 3',
        path: 'garage.shelf-3',
        parentId: 'garage',
        itemCount: 2,
      }),
    ]);

    renderLocationsPage();

    expect(await screen.findByText('Garage')).toBeInTheDocument();
    expect(screen.getByLabelText('5 items')).toBeInTheDocument();
    expect(screen.queryByText('Shelf 3')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand Garage' }));

    expect(await screen.findByText('Shelf 3')).toBeInTheDocument();
    expect(screen.getByLabelText('2 items')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse Garage' }));
    await waitFor(() => expect(screen.queryByText('Shelf 3')).not.toBeInTheDocument());
  });

  it('creates a child location from the tree and invalidates the list', async () => {
    // First load has no children; once the create mutation invalidates
    // `['locations']`, the refetch (and every fetch after) returns the new
    // composed-path child nested under Garage.
    const fetchLocationsMock = vi
      .spyOn(api, 'fetchLocations')
      .mockResolvedValueOnce([loc({ id: 'garage', name: 'Garage', path: 'garage' })])
      .mockResolvedValue([
        loc({ id: 'garage', name: 'Garage', path: 'garage' }),
        loc({
          id: 'shelf-3',
          name: 'Shelf 3',
          path: 'garage.shelf-3',
          parentId: 'garage',
          itemCount: 0,
        }),
      ]);
    const createLocationMock = vi.spyOn(api, 'createLocation').mockResolvedValue(
      loc({
        id: 'shelf-3',
        name: 'Shelf 3',
        path: 'garage.shelf-3',
        parentId: 'garage',
        itemCount: 0,
      }),
    );

    renderLocationsPage();
    const user = userEvent.setup();

    await screen.findByText('Garage');
    await user.click(screen.getByRole('button', { name: 'Add child to Garage' }));

    const input = screen.getByLabelText('New child location name for Garage');
    await user.type(input, 'Shelf 3{Enter}');

    await waitFor(() =>
      expect(createLocationMock).toHaveBeenCalledWith({ name: 'Shelf 3', parentId: 'garage' }),
    );
    await waitFor(() => expect(fetchLocationsMock.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText('Shelf 3')).toBeInTheDocument();
  });

  it('adds a root location via the top-level control', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    const createLocationMock = vi.spyOn(api, 'createLocation').mockResolvedValue(loc());

    renderLocationsPage();
    const user = userEvent.setup();

    await screen.findByText('No locations yet. Add a root location to start building your tree.');
    await user.click(screen.getByRole('button', { name: 'Add root location' }));
    await user.type(screen.getByLabelText('New root location name'), 'Garage{Enter}');

    await waitFor(() =>
      expect(createLocationMock).toHaveBeenCalledWith({ name: 'Garage', parentId: undefined }),
    );
  });

  it('disables delete for a node that still has children', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      loc({ id: 'garage', name: 'Garage', path: 'garage' }),
      loc({ id: 'shelf-3', name: 'Shelf 3', path: 'garage.shelf-3', parentId: 'garage' }),
    ]);

    renderLocationsPage();
    await screen.findByText('Garage');

    const row = screen.getByTestId('location-node-garage');
    expect(within(row).getByRole('button', { name: 'Delete Garage' })).toBeDisabled();
  });
});
