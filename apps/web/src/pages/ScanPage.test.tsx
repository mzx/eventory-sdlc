import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ScanPage } from './ScanPage';

function renderScanPage(token = 'token-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/r/${token}`]}>
        <Routes>
          <Route path="/r/:token" element={<ScanPage />} />
          <Route path="/items/:id" element={<div>item detail {token}</div>} />
          <Route path="/locations/:id" element={<div>location detail</div>} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ScanPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to the item detail page when the token resolves to an item', async () => {
    vi.spyOn(api, 'fetchByQr').mockResolvedValue({
      kind: 'item',
      item: { id: 'item-1' } as api.ItemDetail,
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/r/item-token']}>
          <Routes>
            <Route path="/r/:token" element={<ScanPage />} />
            <Route path="/items/:id" element={<div>item detail page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('item detail page')).toBeInTheDocument();
    expect(api.fetchByQr).toHaveBeenCalledWith('item-token');
  });

  it('redirects to the location detail page when the token resolves to a location', async () => {
    vi.spyOn(api, 'fetchByQr').mockResolvedValue({
      kind: 'location',
      location: { id: 'loc-1', name: 'Garage', path: 'garage', parentId: null, notes: null },
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/r/location-token']}>
          <Routes>
            <Route path="/r/:token" element={<ScanPage />} />
            <Route path="/locations/:id" element={<div>location detail page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('location detail page')).toBeInTheDocument();
  });

  it('shows a friendly "Unknown code" screen with a link home when the token is not found', async () => {
    vi.spyOn(api, 'fetchByQr').mockRejectedValue(new api.QrLookupNotFoundError('garbage-token'));

    renderScanPage('garbage-token');

    expect(await screen.findByText('Unknown code')).toBeInTheDocument();
    const homeLink = screen.getByRole('link', { name: /go home/i });
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('shows a generic error screen for non-404 failures', async () => {
    vi.spyOn(api, 'fetchByQr').mockRejectedValue(
      new Error('Request to /items/by-qr/x failed with status 500'),
    );

    renderScanPage('server-error-token');

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('Request to /items/by-qr/x failed with status 500'),
    ).toBeInTheDocument();
  });

  it('shows a loading state before the lookup resolves', () => {
    vi.spyOn(api, 'fetchByQr').mockReturnValue(new Promise(() => {}));

    renderScanPage();

    expect(screen.getByTestId('scan-loading')).toBeInTheDocument();
  });
});
