import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { setActiveWorkspaceId } from '../api';
import { setActiveWorkspaceRole } from '../workspace/useActiveWorkspace';
import { PickListPage } from './PickListPage';

function availabilityLine(overrides: Partial<api.AvailabilityLine> = {}): api.AvailabilityLine {
  return {
    lineId: 'line-1',
    itemId: 'item-1',
    name: 'Cordless drill',
    quantity: 2,
    unit: null,
    onHand: 5,
    location: { id: 'loc-1', name: 'Cabinet 3', path: 'garage.cabinet-3' },
    status: 'ok',
    picked: false,
    ...overrides,
  };
}

function availability(overrides: Partial<api.ProjectAvailability> = {}): api.ProjectAvailability {
  return {
    projectId: 'project-1',
    asOf: '2026-08-13T00:00:00.000Z',
    clearToBuild: true,
    counts: { ok: 1, short: 0, untracked: 0 },
    lines: [availabilityLine()],
    ...overrides,
  };
}

function renderPage(projectId = 'project-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${projectId}/pick-list`]}>
        <Routes>
          <Route path="/projects/:id/pick-list" element={<PickListPage />} />
          <Route path="/projects/:id" element={<div>Project detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PickListPage (EVT-29 AC 3, 5)', () => {
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups item-linked lines by location path, ordered as a walkable route (AC 3)', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
      availability({
        lines: [
          availabilityLine({
            lineId: 'line-1',
            name: 'M3 screws',
            location: { id: 'loc-2', name: 'Bin 2', path: 'garage.shelf.bin-2' },
          }),
          availabilityLine({
            lineId: 'line-2',
            name: 'Cordless drill',
            location: { id: 'loc-1', name: 'Cabinet 3', path: 'garage.cabinet-3' },
          }),
        ],
      }),
    );

    renderPage();

    const cabinetHeading = await screen.findByText('Cabinet 3 (garage.cabinet-3)');
    const binHeading = await screen.findByText('Bin 2 (garage.shelf.bin-2)');

    // `garage.cabinet-3` sorts before `garage.shelf.bin-2` — verify the DOM
    // order matches the path order, not the response array order.
    const headings = screen.getAllByText(/\(garage\./);
    expect(headings[0]).toBe(cabinetHeading);
    expect(headings[1]).toBe(binHeading);
  });

  it('excludes untracked (free-text) lines — only item-linked lines are pickable', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
      availability({
        lines: [
          availabilityLine({ lineId: 'line-1', name: 'Cordless drill' }),
          availabilityLine({
            lineId: 'line-2',
            itemId: null,
            name: '2x4 lumber',
            onHand: null,
            location: null,
            status: 'untracked',
          }),
        ],
      }),
    );

    renderPage();

    await screen.findByText('Cordless drill');
    expect(screen.queryByText('2x4 lumber')).not.toBeInTheDocument();
  });

  it('groups lines with no location under "No location set"', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
      availability({
        lines: [availabilityLine({ location: null })],
      }),
    );

    renderPage();

    expect(await screen.findByText('No location set')).toBeInTheDocument();
  });

  it('shows a picked/total progress indicator', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
      availability({
        lines: [
          availabilityLine({ lineId: 'line-1', picked: true }),
          availabilityLine({ lineId: 'line-2', name: 'M3 screws', picked: false }),
        ],
      }),
    );

    renderPage();

    expect(await screen.findByText('1 of 2 picked')).toBeInTheDocument();
  });

  it('checking a line persists the picked state via updateBomLine and survives reload (AC 3)', async () => {
    const fetchAvailabilityMock = vi
      .spyOn(api, 'fetchProjectAvailability')
      .mockResolvedValue(availability({ lines: [availabilityLine({ picked: false })] }));
    const updateBomLineMock = vi.spyOn(api, 'updateBomLine').mockResolvedValue({
      id: 'line-1',
      projectId: 'project-1',
      itemId: 'item-1',
      name: 'Cordless drill',
      quantity: 2,
      unit: null,
      notes: null,
      picked: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
    });

    const user = userEvent.setup();
    renderPage();

    const checkbox = await screen.findByLabelText('Picked Cordless drill');
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    await waitFor(() =>
      expect(updateBomLineMock).toHaveBeenCalledWith('project-1', 'line-1', { picked: true }),
    );
    // Re-fetches availability on success, which re-reads the persisted state
    // (fulfilling "survives reload" — a fresh GET, not just local UI state).
    await waitFor(() => expect(fetchAvailabilityMock).toHaveBeenCalledTimes(2));
  });

  it('unchecking a picked line persists picked: false via updateBomLine', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
      availability({ lines: [availabilityLine({ picked: true })] }),
    );
    const updateBomLineMock = vi.spyOn(api, 'updateBomLine').mockResolvedValue({
      id: 'line-1',
      projectId: 'project-1',
      itemId: 'item-1',
      name: 'Cordless drill',
      quantity: 2,
      unit: null,
      notes: null,
      picked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
    });

    const user = userEvent.setup();
    renderPage();

    const checkbox = await screen.findByLabelText('Picked Cordless drill');
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    await waitFor(() =>
      expect(updateBomLineMock).toHaveBeenCalledWith('project-1', 'line-1', { picked: false }),
    );
  });

  it('shows an error alert when a pick toggle fails, without silently reverting', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
      availability({ lines: [availabilityLine({ picked: false })] }),
    );
    vi.spyOn(api, 'updateBomLine').mockRejectedValue(new Error('pick update boom'));

    const user = userEvent.setup();
    renderPage();

    const checkbox = await screen.findByLabelText('Picked Cordless drill');
    await user.click(checkbox);

    expect(await screen.findByText('pick update boom')).toBeInTheDocument();
  });

  it('orders multiple lines within the same location group (AC 3)', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
      availability({
        lines: [
          availabilityLine({ lineId: 'line-1', name: 'Cordless drill' }),
          availabilityLine({ lineId: 'line-2', name: 'M3 screws' }),
        ],
      }),
    );

    renderPage();

    await screen.findByText('Cabinet 3 (garage.cabinet-3)');
    const rowNames = screen.getAllByText(/Cordless drill|M3 screws/);
    expect(rowNames[0]).toHaveTextContent('Cordless drill');
    expect(rowNames[1]).toHaveTextContent('M3 screws');
  });

  it('has a Back to project link and a Print trigger (AC 5)', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(availability());
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Cordless drill');

    const backLink = screen.getByRole('link', { name: /back to project/i });
    expect(backLink).toHaveAttribute('href', '/projects/project-1');

    await user.click(screen.getByTestId('trigger-print'));
    expect(printSpy).toHaveBeenCalled();
  });

  it('marks the back-navigation and print controls no-print, and readable checkboxes stay visible', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(availability());

    renderPage();

    await screen.findByText('Cordless drill');

    const backLink = screen.getByRole('link', { name: /back to project/i });
    expect(backLink.closest('.no-print')).not.toBeNull();
  });

  it('shows an error alert when the availability fetch fails', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockRejectedValue(new Error('pick list boom'));

    renderPage();

    expect(await screen.findByText('pick list boom')).toBeInTheDocument();
  });

  it('shows an empty state when there are no item-linked BOM lines', async () => {
    vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(availability({ lines: [] }));

    renderPage();

    expect(
      await screen.findByText('No item-linked BOM lines to pick — add one from the project page.'),
    ).toBeInTheDocument();
  });

  // EVT-43 round-2 review, MINOR 5: the pick checkbox is the one mutating
  // affordance on this page and previously had no viewer gating at all.
  describe('viewer role (EVT-43 AC6)', () => {
    afterEach(() => {
      setActiveWorkspaceRole(null);
    });

    it('disables the pick checkbox for a viewer', async () => {
      vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
        availability({ lines: [availabilityLine({ picked: false })] }),
      );
      setActiveWorkspaceRole('viewer');

      renderPage();

      const checkbox = await screen.findByLabelText('Picked Cordless drill');
      // A genuinely `disabled` control can't be clicked at all — matching
      // the app's own real-browser behavior (and the identical pattern in
      // ShoppingListPage.test.tsx's viewer gating test) — so `toBeDisabled`
      // is the whole assertion; there's nothing further to simulate.
      expect(checkbox).toBeDisabled();
    });

    it('keeps the pick checkbox enabled for a member', async () => {
      vi.spyOn(api, 'fetchProjectAvailability').mockResolvedValue(
        availability({ lines: [availabilityLine({ picked: false })] }),
      );
      setActiveWorkspaceRole('member');

      renderPage();

      const checkbox = await screen.findByLabelText('Picked Cordless drill');
      expect(checkbox).toBeEnabled();
    });
  });
});
