import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    consumed: [],
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

function previewLine(overrides: Partial<api.BackflushPreviewLine> = {}): api.BackflushPreviewLine {
  return {
    lineId: 'line-1',
    itemId: 'item-1',
    name: 'Cordless drill',
    quantity: 3,
    unit: null,
    onHand: 5,
    suggestedConsumeQuantity: 3,
    shortage: false,
    skipped: false,
    ...overrides,
  };
}

function preview(overrides: Partial<api.BackflushPreview> = {}): api.BackflushPreview {
  return {
    projectId: 'project-1',
    alreadyBackflushed: false,
    lines: [previewLine()],
    ...overrides,
  };
}

function consumedMovement(overrides: Partial<api.ConsumedMovement> = {}): api.ConsumedMovement {
  return {
    id: 'mv-1',
    itemId: 'item-1',
    kind: 'build',
    delta: -2,
    projectId: 'project-1',
    note: 'Backflush: project completion',
    createdAt: '2026-02-01T00:00:00.000Z',
    item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
    ...overrides,
  };
}

/** Opens the Status select and picks the given option label. */
async function selectStatus(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByLabelText('Status'));
  await user.click(await screen.findByRole('option', { name: label }));
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

  // ── backflush — build completion consumes BOM stock (EVT-28) ────────────

  describe('backflush confirmation (EVT-28)', () => {
    it('selecting Completed with an item-linked BOM line shows the confirmation screen (AC 1)', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: 'item-1', quantity: 3 })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(
        preview({ lines: [previewLine({ quantity: 3, onHand: 5 })] }),
      );
      const updateProjectMock = vi.spyOn(api, 'updateProject');

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');

      await selectStatus(user, 'Completed');

      expect(
        await screen.findByText('Complete project — confirm stock consumption'),
      ).toBeInTheDocument();
      expect(screen.getByText('Cordless drill')).toBeInTheDocument();
      expect(screen.getByLabelText('Consume quantity for Cordless drill')).toHaveValue(3);
      // The plain status PATCH must not fire — only the backflush confirm does.
      expect(updateProjectMock).not.toHaveBeenCalled();
    });

    it('shortage lines are highlighted (AC 4)', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: 'item-1', quantity: 5 })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(
        preview({ lines: [previewLine({ quantity: 5, onHand: 2, shortage: true })] }),
      );

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      await screen.findByText('Complete project — confirm stock consumption');
      expect(screen.getByText('Shortage')).toBeInTheDocument();
    });

    it('free-text lines are listed as skipped, not editable (AC 3)', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({
          bomLines: [
            bomLine({ id: 'line-1', itemId: 'item-1', quantity: 3 }),
            bomLine({ id: 'line-2', itemId: null, name: '2x4 lumber' }),
          ],
        }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(
        preview({
          lines: [
            previewLine({ lineId: 'line-1' }),
            previewLine({
              lineId: 'line-2',
              itemId: null,
              name: '2x4 lumber',
              onHand: null,
              suggestedConsumeQuantity: 0,
              skipped: true,
            }),
          ],
        }),
      );

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      const dialog = within(await screen.findByRole('dialog'));
      await dialog.findByText('Not tracked — skipped:');
      expect(dialog.getByText('2x4 lumber')).toBeInTheDocument();
      expect(screen.queryByLabelText('Consume quantity for 2x4 lumber')).not.toBeInTheDocument();
    });

    it('confirming calls confirmBackflush with the (editable) per-line quantities and closes the dialog (AC 2)', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: 'item-1', quantity: 3 })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(
        preview({ lines: [previewLine({ lineId: 'line-1', quantity: 3, onHand: 5 })] }),
      );
      const confirmBackflushMock = vi.spyOn(api, 'confirmBackflush').mockResolvedValue({
        project: project({ status: 'completed' }),
        consumed: [],
      });

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      const qtyInput = await screen.findByLabelText('Consume quantity for Cordless drill');
      await user.clear(qtyInput);
      await user.type(qtyInput, '2');

      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() =>
        expect(confirmBackflushMock).toHaveBeenCalledWith('project-1', {
          lines: [{ lineId: 'line-1', consumeQuantity: 2 }],
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByText('Complete project — confirm stock consumption'),
        ).not.toBeInTheDocument(),
      );
    });

    it('review round 2, finding 8: shows an error alert when loading the confirmation screen fails', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: 'item-1', quantity: 3 })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockRejectedValue(new Error('preview boom'));

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      expect(await screen.findByText('preview boom')).toBeInTheDocument();
      // The dialog itself never opens — there's nothing to confirm.
      expect(
        screen.queryByText('Complete project — confirm stock consumption'),
      ).not.toBeInTheDocument();
    });

    it('review round 2, finding 8: shows an error alert inside the dialog when confirming fails', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: 'item-1', quantity: 3 })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(
        preview({ lines: [previewLine({ lineId: 'line-1', quantity: 3, onHand: 5 })] }),
      );
      vi.spyOn(api, 'confirmBackflush').mockRejectedValue(new Error('confirm boom'));

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      const dialog = within(await screen.findByRole('dialog'));
      await user.click(dialog.getByRole('button', { name: 'Confirm' }));

      expect(await dialog.findByText('confirm boom')).toBeInTheDocument();
      // The dialog stays open on failure — nothing was confirmed.
      expect(screen.getByText('Complete project — confirm stock consumption')).toBeInTheDocument();
    });

    it('cancelling the dialog writes nothing', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: 'item-1', quantity: 3 })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(preview());
      const confirmBackflushMock = vi.spyOn(api, 'confirmBackflush');

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      await screen.findByText('Complete project — confirm stock consumption');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(
          screen.queryByText('Complete project — confirm stock consumption'),
        ).not.toBeInTheDocument(),
      );
      expect(confirmBackflushMock).not.toHaveBeenCalled();
    });

    it('a project with no item-linked BOM lines completes directly, without the confirmation screen', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: null, name: '2x4 lumber' })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(
        preview({
          lines: [
            previewLine({
              itemId: null,
              name: '2x4 lumber',
              onHand: null,
              suggestedConsumeQuantity: 0,
              skipped: true,
            }),
          ],
        }),
      );
      const updateProjectMock = vi
        .spyOn(api, 'updateProject')
        .mockResolvedValue(project({ status: 'completed' }));

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      await waitFor(() =>
        expect(updateProjectMock).toHaveBeenCalledWith('project-1', { status: 'completed' }),
      );
      expect(
        screen.queryByText('Complete project — confirm stock consumption'),
      ).not.toBeInTheDocument();
    });

    it('idempotency: Confirm is disabled until "Consume again" is checked when already backflushed (AC 6)', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ bomLines: [bomLine({ itemId: 'item-1', quantity: 3 })] }),
      );
      vi.spyOn(api, 'fetchBackflushPreview').mockResolvedValue(
        preview({ alreadyBackflushed: true }),
      );
      const confirmBackflushMock = vi.spyOn(api, 'confirmBackflush').mockResolvedValue({
        project: project({ status: 'completed' }),
        consumed: [],
      });

      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Garage workbench');
      await selectStatus(user, 'Completed');

      await screen.findByText('Complete project — confirm stock consumption');
      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmButton).toBeDisabled();

      await user.click(screen.getByRole('checkbox', { name: 'Consume again' }));
      expect(confirmButton).toBeEnabled();

      await user.click(confirmButton);

      await waitFor(() =>
        expect(confirmBackflushMock).toHaveBeenCalledWith(
          'project-1',
          expect.objectContaining({ confirmAgain: true }),
        ),
      );
    });
  });

  // ── Consumed section (EVT-28 AC 5) ───────────────────────────────────────

  describe('Consumed section (EVT-28 AC 5)', () => {
    it('shows the consumed record, linking back to the item', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ status: 'completed', consumed: [consumedMovement({ delta: -2 })] }),
      );

      renderPage();

      expect(await screen.findByText('Consumed')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: 'Cordless drill' });
      expect(link).toHaveAttribute('href', '/items/item-1');
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders nothing when the project has never been backflushed', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(project({ consumed: [] }));

      renderPage();

      await screen.findByText('Garage workbench');
      expect(screen.queryByText('Consumed')).not.toBeInTheDocument();
    });

    it('re-opening a completed project shows a notice that consumption stands (AC 6 non-goal)', async () => {
      vi.spyOn(api, 'fetchProject').mockResolvedValue(
        project({ status: 'planned', consumed: [consumedMovement()] }),
      );

      renderPage();

      expect(await screen.findByText(/does not reverse that consumption/i)).toBeInTheDocument();
    });
  });
});
