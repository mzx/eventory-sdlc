import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ProjectDetailPage } from './ProjectDetailPage';

function project(overrides: Partial<api.ProjectDetail> = {}): api.ProjectDetail {
  return {
    id: 'project-1',
    name: 'Garage workbench',
    description: null,
    status: 'planned',
    notes: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    bomLines: [],
    ...overrides,
  };
}

function bomLine(overrides: Partial<api.BomLine> = {}): api.BomLine {
  return {
    id: 'line-1',
    projectId: 'project-1',
    itemId: null,
    name: '2x4 lumber',
    quantity: 1,
    unit: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    item: null,
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
    qrCode: 'qr-1',
    locationId: null,
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

function renderPage(projectId = 'project-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/items/:id" element={<div>Item detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectDetailPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the project header and BOM lines, with linked lines as links to the item', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(
      project({
        bomLines: [
          bomLine({
            id: 'line-1',
            itemId: 'item-1',
            name: 'Cordless drill',
            quantity: 2,
            unit: 'pcs',
            item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
          }),
          bomLine({ id: 'line-2', name: '2x4 lumber', quantity: 4 }),
        ],
      }),
    );

    renderPage();

    expect(await screen.findByText('Garage workbench')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Cordless drill' });
    expect(link).toHaveAttribute('href', '/items/item-1');

    // The free-text line renders as plain text, not a link.
    expect(screen.getByText('2x4 lumber')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '2x4 lumber' })).not.toBeInTheDocument();
  });

  it('a linked BOM line navigates to the item detail page', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(
      project({
        bomLines: [
          bomLine({
            itemId: 'item-1',
            name: 'Cordless drill',
            item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
          }),
        ],
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const link = await screen.findByRole('link', { name: 'Cordless drill' });
    await user.click(link);

    expect(await screen.findByText('Item detail page')).toBeInTheDocument();
  });

  it('adds a linked BOM line by selecting an item from the autocomplete (AC 2)', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(project());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([item()]);
    const addBomLineMock = vi.spyOn(api, 'addBomLine').mockResolvedValue(
      bomLine({
        itemId: 'item-1',
        name: 'Cordless drill',
        item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garage workbench');

    const autocomplete = screen.getByLabelText('Item or free text');
    await user.type(autocomplete, 'drill');

    const option = await screen.findByText('Cordless drill');
    await user.click(option);

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(addBomLineMock).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({ itemId: 'item-1' }),
      ),
    );
  });

  it('adds a free-text BOM line (AC 2)', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(project());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    const addBomLineMock = vi
      .spyOn(api, 'addBomLine')
      .mockResolvedValue(bomLine({ name: '2x4 lumber', quantity: 4 }));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garage workbench');

    const autocomplete = screen.getByLabelText('Item or free text');
    await user.type(autocomplete, '2x4 lumber');

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(addBomLineMock).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({ name: '2x4 lumber', itemId: undefined }),
      ),
    );
  });

  it('deleting an inventory item leaves the BOM line with its copied name and item null (AC 3)', async () => {
    // Simulates the API state after the linked item was deleted: `itemId`
    // becomes null (schema onDelete: SetNull) but `name` stays as copied.
    vi.spyOn(api, 'fetchProject').mockResolvedValue(
      project({
        bomLines: [bomLine({ itemId: null, name: 'Cordless drill', item: null })],
      }),
    );

    renderPage();

    expect(await screen.findByText('Cordless drill')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cordless drill' })).not.toBeInTheDocument();
  });

  it('clicking a BOM line delete button calls deleteBomLine with the project and line id', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(
      project({ bomLines: [bomLine({ id: 'line-1', name: '2x4 lumber' })] }),
    );
    const deleteBomLineMock = vi.spyOn(api, 'deleteBomLine').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    const deleteButton = await screen.findByRole('button', { name: 'Delete 2x4 lumber' });
    await user.click(deleteButton);

    await waitFor(() => expect(deleteBomLineMock).toHaveBeenCalledWith('project-1', 'line-1'));
  });

  it('clicking the unlink button on a linked BOM line calls updateBomLine with itemId: null', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(
      project({
        bomLines: [
          bomLine({
            id: 'line-1',
            itemId: 'item-1',
            name: 'Cordless drill',
            item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
          }),
        ],
      }),
    );
    const updateBomLineMock = vi
      .spyOn(api, 'updateBomLine')
      .mockResolvedValue(
        bomLine({ id: 'line-1', itemId: null, name: 'Cordless drill', item: null }),
      );

    const user = userEvent.setup();
    renderPage();

    const unlinkButton = await screen.findByRole('button', { name: 'Unlink Cordless drill' });
    await user.click(unlinkButton);

    await waitFor(() =>
      expect(updateBomLineMock).toHaveBeenCalledWith('project-1', 'line-1', { itemId: null }),
    );
  });

  it('does not render an unlink button for a free-text (unlinked) BOM line', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(
      project({ bomLines: [bomLine({ id: 'line-1', name: '2x4 lumber' })] }),
    );

    renderPage();

    await screen.findByText('2x4 lumber');
    expect(screen.queryByRole('button', { name: 'Unlink 2x4 lumber' })).not.toBeInTheDocument();
  });

  it('rejects a negative quantity by clamping it to 1 before sending the add request', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(project());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    const addBomLineMock = vi
      .spyOn(api, 'addBomLine')
      .mockResolvedValue(bomLine({ name: 'Screws', quantity: 1 }));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garage workbench');

    const autocomplete = screen.getByLabelText('Item or free text');
    await user.type(autocomplete, 'Screws');

    const qtyInput = screen.getByLabelText('Quantity');
    await user.clear(qtyInput);
    await user.type(qtyInput, '-5');

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(addBomLineMock).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({ quantity: 1 }),
      ),
    );
  });

  it('surfaces an error alert when the add-line mutation fails', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(project());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'addBomLine').mockRejectedValue(new Error('Request to /projects failed'));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garage workbench');

    const autocomplete = screen.getByLabelText('Item or free text');
    await user.type(autocomplete, 'Broken line');

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Request to /projects failed')).toBeInTheDocument();
  });

  it('clicking "Delete project" calls deleteProject with the project id', async () => {
    vi.spyOn(api, 'fetchProject').mockResolvedValue(project());
    const deleteProjectMock = vi.spyOn(api, 'deleteProject').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Garage workbench');
    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledWith('project-1'));
  });
});
