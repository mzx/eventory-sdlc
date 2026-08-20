import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { setActiveWorkspaceId } from '../api';
import { setActiveWorkspaceRole } from '../workspace/useActiveWorkspace';
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
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
    setActiveWorkspaceRole('owner');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('EVT-43 AC6: hides "Add root location" for a viewer', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
    setActiveWorkspaceRole('viewer');

    renderLocationsPage();

    await screen.findByText(/no locations yet/i);
    expect(screen.queryByRole('button', { name: /add root location/i })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
  });

  // Round-2 review, MAJOR 2: the tree's own per-row add/rename/delete
  // controls previously ignored the caller's role entirely — the top-level
  // "Add root location" gate above doesn't cover them.
  it('EVT-43 AC6: hides the per-row add/rename/delete controls in the tree for a viewer', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      loc({ id: 'garage', name: 'Garage', path: 'garage', parentId: null, itemCount: 5 }),
    ]);
    setActiveWorkspaceRole('viewer');

    renderLocationsPage();

    expect(await screen.findByText('Garage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add child to Garage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename Garage' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More actions for Garage' }),
    ).not.toBeInTheDocument();
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
      expect(createLocationMock).toHaveBeenCalledWith({
        name: 'Shelf 3',
        parentId: 'garage',
        kind: 'area',
      }),
    );
    await waitFor(() => expect(fetchLocationsMock.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText('Shelf 3')).toBeInTheDocument();
  });

  it('creates a container child when the Container toggle is selected (EVT-30 AC 1)', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      loc({ id: 'garage', name: 'Garage', path: 'garage' }),
    ]);
    const createLocationMock = vi.spyOn(api, 'createLocation').mockResolvedValue(
      loc({
        id: 'box-1',
        name: 'Tote Box',
        path: 'garage.tote-box',
        parentId: 'garage',
        kind: 'container',
      }),
    );

    renderLocationsPage();
    const user = userEvent.setup();

    await screen.findByText('Garage');
    await user.click(screen.getByRole('button', { name: 'Add child to Garage' }));
    await user.click(screen.getByRole('button', { name: 'Container' }));

    const input = screen.getByLabelText('New child location name for Garage');
    await user.type(input, 'Tote Box{Enter}');

    await waitFor(() =>
      expect(createLocationMock).toHaveBeenCalledWith({
        name: 'Tote Box',
        parentId: 'garage',
        kind: 'container',
      }),
    );
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
      expect(createLocationMock).toHaveBeenCalledWith({
        name: 'Garage',
        parentId: undefined,
        kind: 'area',
      }),
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

  it('renames a location and invalidates the list', async () => {
    const fetchLocationsMock = vi
      .spyOn(api, 'fetchLocations')
      .mockResolvedValueOnce([loc({ id: 'garage', name: 'Garage', path: 'garage' })])
      .mockResolvedValue([loc({ id: 'garage', name: 'Garage HQ', path: 'garage-hq' })]);
    const renameLocationMock = vi
      .spyOn(api, 'renameLocation')
      .mockResolvedValue(loc({ id: 'garage', name: 'Garage HQ', path: 'garage-hq' }));

    renderLocationsPage();
    const user = userEvent.setup();

    await screen.findByText('Garage');
    await user.click(screen.getByRole('button', { name: 'Rename Garage' }));

    const input = screen.getByRole('textbox', { name: 'Rename Garage' });
    await user.clear(input);
    await user.type(input, 'Garage HQ{Enter}');

    await waitFor(() => expect(renameLocationMock).toHaveBeenCalledWith('garage', 'Garage HQ'));
    await waitFor(() => expect(fetchLocationsMock.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText('Garage HQ')).toBeInTheDocument();
  });

  it('reseeds the rename input from the current name on each rename click', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      loc({ id: 'garage', name: 'Garage', path: 'garage' }),
    ]);
    vi.spyOn(api, 'renameLocation').mockResolvedValue(loc());

    renderLocationsPage();
    const user = userEvent.setup();

    await screen.findByText('Garage');
    await user.click(screen.getByRole('button', { name: 'Rename Garage' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Garage' }), ' stale{Escape}');

    // Escape cancels without submitting; the underlying name is unchanged.
    expect(await screen.findByText('Garage')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rename Garage' }));
    expect(screen.getByRole('textbox', { name: 'Rename Garage' })).toHaveValue('Garage');
  });

  it('confirms before deleting and skips the mutation if the user cancels', async () => {
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      loc({ id: 'garage', name: 'Garage', path: 'garage' }),
    ]);
    const deleteLocationMock = vi.spyOn(api, 'deleteLocation').mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderLocationsPage();
    const user = userEvent.setup();

    await screen.findByText('Garage');
    await user.click(screen.getByRole('button', { name: 'Delete Garage' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteLocationMock).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete Garage' }));
    await waitFor(() => expect(deleteLocationMock).toHaveBeenCalledWith('garage'));
  });
});
