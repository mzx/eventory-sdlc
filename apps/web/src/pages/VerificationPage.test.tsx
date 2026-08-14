import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { VerificationPage } from './VerificationPage';

function row(overrides: Partial<api.VerificationQueueRow> = {}): api.VerificationQueueRow {
  return {
    id: 'item-1',
    name: 'Box of Screws',
    quantity: 12,
    qrCode: 'qr-1',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    countIntervalDays: 30,
    createdAt: '2025-12-01T00:00:00.000Z',
    primaryPhoto: null,
    location: { id: 'loc-1', name: 'Garage', path: 'garage' },
    daysOverdue: 5,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/verification']}>
        <Routes>
          <Route path="/verification" element={<VerificationPage />} />
          <Route path="/items/:id" element={<div>item detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VerificationPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // AC 3 — list shape, ordering (server-supplied), empty state
  // =========================================================================

  it('renders overdue rows with days-overdue and location', async () => {
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([row()]);

    renderPage();

    expect(await screen.findByText('Box of Screws')).toBeInTheDocument();
    expect(screen.getByText('5 days overdue — Garage')).toBeInTheDocument();
  });

  it('renders "1 day overdue" (singular) for exactly one day', async () => {
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([row({ daysOverdue: 1 })]);

    renderPage();

    expect(await screen.findByText(/1 day overdue/)).toBeInTheDocument();
  });

  it('renders "Due today" for a row exactly on its due date (daysOverdue 0)', async () => {
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([row({ daysOverdue: 0 })]);

    renderPage();

    expect(await screen.findByText(/Due today/)).toBeInTheDocument();
  });

  it('renders rows in the order the API returns them (most-overdue first is a server contract)', async () => {
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([
      row({ id: 'item-a', name: 'Very Overdue Item', daysOverdue: 40 }),
      row({ id: 'item-b', name: 'Barely Overdue Item', daysOverdue: 1 }),
    ]);

    renderPage();

    const names = (await screen.findAllByRole('link')).map((el) => el.textContent);
    expect(names).toEqual(['Very Overdue Item', 'Barely Overdue Item']);
  });

  it('shows a designed empty state, not a blank page, when nothing is due', async () => {
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('Nothing due')).toBeInTheDocument();
  });

  it('shows an error alert when the queue fails to load', async () => {
    vi.spyOn(api, 'fetchVerificationQueue').mockRejectedValue(new Error('Network error'));

    renderPage();

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  // =========================================================================
  // EVT-37 finding #6 — the "Count" button sits in a normal flex row
  // (not `secondaryAction`, which only reserves 48px) so it never overlaps
  // the item name/summary, and a long name truncates with an ellipsis
  // instead of pushing the button off-row at ~390px.
  // =========================================================================

  it('EVT-37 AC2: a long item name truncates (noWrap) instead of wrapping onto the Count button', async () => {
    const longName = 'A'.repeat(120);
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([row({ name: longName })]);

    renderPage();

    const nameLink = await screen.findByText(longName);
    expect(nameLink).toHaveClass('MuiTypography-noWrap');
    expect(screen.getByText('5 days overdue — Garage')).toHaveClass('MuiTypography-noWrap');
    // A normal flex row (not `secondaryAction`, which absolutely positions
    // and only reserves 48px) — the button never overlaps the text column.
    const rowEl = nameLink.closest('li');
    expect(rowEl?.querySelector('.MuiListItemSecondaryAction-root')).toBeNull();
    expect(screen.getByRole('button', { name: 'Count' })).toBeInTheDocument();
  });

  // =========================================================================
  // Inline blind count (shares CountDialog with ItemDetailPage's "Verify count")
  // =========================================================================

  it('tapping "Count" opens the blind CountDialog for that row and records the count', async () => {
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([row()]);
    const countMock = vi.spyOn(api, 'countItem').mockResolvedValue({
      item: {} as api.ItemDetail,
      bookQuantity: 12,
      countedQuantity: 10,
      delta: -2,
    });
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Count' }));
    expect(screen.getByText('How many are there?')).toBeInTheDocument();
    // Blind entry — book quantity must not be visible before submit.
    expect(screen.queryByText(/book quantity/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Counted quantity'), '10');
    await user.click(screen.getByRole('button', { name: 'Submit count' }));

    expect(countMock).toHaveBeenCalledWith('item-1', 10);
    expect(await screen.findByText(/Book quantity was 12/)).toBeInTheDocument();
  });
});
