import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { IntakePage } from './IntakePage';

const STUB_ANALYSIS: api.PhotoSearchAnalysis = {
  suggested_name: 'Unknown item',
  description: '',
  tags: [],
  color: null,
  quantity: null,
  unit: null,
  properties: {},
  search_keywords: [],
};

function uploaded(overrides: Partial<api.UploadedPhoto> = {}): api.UploadedPhoto {
  return {
    id: 'photo-1',
    filename: 'drill.jpg',
    mimeType: 'image/jpeg',
    url: '/storage/drill.jpg',
    ...overrides,
  };
}

function renderIntakePage(initialEntry = '/intake') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/items/:id" element={<div>detail page</div>} />
          <Route path="/" element={<div>items list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockDirectories() {
  vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
  vi.spyOn(api, 'fetchLocations').mockResolvedValue([]);
  vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
}

/** The camera-capture input — the only one carrying `capture="environment"`. */
function getCameraInput(): HTMLInputElement {
  return document.querySelector('input[type="file"][capture]') as HTMLInputElement;
}

/** The gallery/file-picker input — deliberately WITHOUT the `capture` attribute. */
function getGalleryInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
}

// Existing tests exercise the camera-capture input by default; it is
// functionally identical to `getCameraInput()`.
const getFileInput = getCameraInput;

describe('IntakePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // AC 1 — desktop flow with stub AI (no key): upload → form prefilled with
  // stub → save → the created item is returned with the uploaded photo as
  // its (first, i.e. primary) photoId.
  // ---------------------------------------------------------------------------
  it('AC1: uploads a photo, prefills from a stub AI draft, and saves with the photo attached', async () => {
    mockDirectories();
    const uploadMock = vi
      .spyOn(api, 'uploadPhoto')
      .mockResolvedValue(uploaded({ aiAnalysis: STUB_ANALYSIS }));
    const createMock = vi.spyOn(api, 'createItem').mockResolvedValue({
      id: 'item-1',
    } as api.ItemDetail);

    renderIntakePage();

    const file = new File(['bytes'], 'drill.jpg', { type: 'image/jpeg' });
    await userEvent.upload(getFileInput(), file);

    expect(await screen.findByLabelText('Name')).toHaveValue('Unknown item');
    expect(uploadMock).toHaveBeenCalledWith(file, undefined, true);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Unknown item', photoIds: ['photo-1'] }),
      ),
    );
    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // AC 2 — `?locationId=` pre-selects the location field and it is saved.
  // ---------------------------------------------------------------------------
  it('AC2: pre-selects the location from ?locationId= and includes it in the save payload', async () => {
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchLocations').mockResolvedValue([
      { id: 'loc-1', name: 'Garage', path: 'garage', parentId: null, qrCode: 'q1', itemCount: 3 },
    ]);
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([]);
    const createMock = vi.spyOn(api, 'createItem').mockResolvedValue({
      id: 'item-2',
    } as api.ItemDetail);

    renderIntakePage('/intake?locationId=loc-1');

    // Skip the photo step to reach the form directly.
    await userEvent.click(screen.getByRole('button', { name: 'Skip photo' }));

    expect(await screen.findByText('Garage')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Extension cord');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: 'loc-1', photoIds: undefined }),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // AC 3 — AI failure/timeout degrades to an empty form with the photo still
  // attached; saving is never blocked.
  // ---------------------------------------------------------------------------
  it('AC3: falls back to a plain upload and an empty form when the analyzed upload fails', async () => {
    mockDirectories();
    const uploadMock = vi
      .spyOn(api, 'uploadPhoto')
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(uploaded());
    const createMock = vi.spyOn(api, 'createItem').mockResolvedValue({
      id: 'item-3',
    } as api.ItemDetail);

    renderIntakePage();

    const file = new File(['bytes'], 'drill.jpg', { type: 'image/jpeg' });
    await userEvent.upload(getFileInput(), file);

    // Lands on the form step with an empty name — never blocked by the failure.
    const nameInput = await screen.findByLabelText('Name');
    expect(nameInput).toHaveValue('');
    expect(uploadMock).toHaveBeenNthCalledWith(1, file, undefined, true);
    expect(uploadMock).toHaveBeenNthCalledWith(2, file, undefined, false);

    await userEvent.type(nameInput, 'Mystery box');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The photo from the successful fallback upload is still attached.
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Mystery box', photoIds: ['photo-1'] }),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // AC 4 — component test: form prefill mapping from a canned aiAnalysis fixture.
  // ---------------------------------------------------------------------------
  it('AC4: maps a canned aiAnalysis fixture onto the form fields', async () => {
    mockDirectories();
    vi.spyOn(api, 'uploadPhoto').mockResolvedValue(
      uploaded({
        aiAnalysis: {
          suggested_name: 'Cordless drill',
          description: 'An 18V cordless drill/driver.',
          tags: ['power-tools', 'bosch'],
          color: 'yellow',
          quantity: 2,
          unit: 'units',
          properties: { voltage: '18V' },
          search_keywords: ['impact driver', 'M12 chuck'],
        },
      }),
    );

    renderIntakePage();

    const file = new File(['bytes'], 'drill.jpg', { type: 'image/jpeg' });
    await userEvent.upload(getFileInput(), file);

    expect(await screen.findByLabelText('Name')).toHaveValue('Cordless drill');
    expect(screen.getByLabelText('Quantity')).toHaveValue(2);
    expect(screen.getByLabelText('Unit')).toHaveValue('units');
    expect(screen.getByText('power-tools')).toBeInTheDocument();
    expect(screen.getByText('bosch')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue(
      'An 18V cordless drill/driver.\n\nKeywords: impact driver, M12 chuck',
    );

    // `color` is merged into the properties editor alongside the model's
    // own confident properties.
    const keyInputs = screen.getAllByLabelText('Key');
    const keys = keyInputs.map((input) => (input as HTMLInputElement).value);
    expect(keys).toEqual(expect.arrayContaining(['voltage', 'color']));
    const valueInputs = screen.getAllByLabelText('Value');
    const values = valueInputs.map((input) => (input as HTMLInputElement).value);
    expect(values).toEqual(expect.arrayContaining(['18V', 'yellow']));

    expect(screen.getByText('AI draft — check before saving')).toBeInTheDocument();
  });

  it('skips the photo step for manual entry and saves without photoIds', async () => {
    mockDirectories();
    const createMock = vi.spyOn(api, 'createItem').mockResolvedValue({
      id: 'item-4',
    } as api.ItemDetail);

    renderIntakePage();

    await userEvent.click(screen.getByRole('button', { name: 'Skip photo' }));
    await userEvent.type(await screen.findByLabelText('Name'), 'Hand-entered widget');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Hand-entered widget', photoIds: undefined }),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // AC 1 / AC 5 — the capture input still forces the rear camera on mobile.
  // ---------------------------------------------------------------------------
  it('AC1/AC5: the camera-capture input carries capture="environment"', async () => {
    mockDirectories();
    renderIntakePage();

    expect(getCameraInput()).toHaveAttribute('capture', 'environment');
    expect(getGalleryInput()).not.toHaveAttribute('capture');
  });

  // ---------------------------------------------------------------------------
  // AC 2 / AC 5 — choosing a file via the non-capture "Choose image" input
  // triggers the identical upload + AI-draft pipeline as camera capture.
  // ---------------------------------------------------------------------------
  it('AC2/AC5: choosing an existing image via the gallery input uploads and prefills the draft', async () => {
    mockDirectories();
    const uploadMock = vi
      .spyOn(api, 'uploadPhoto')
      .mockResolvedValue(uploaded({ aiAnalysis: STUB_ANALYSIS }));
    const createMock = vi.spyOn(api, 'createItem').mockResolvedValue({
      id: 'item-5',
    } as api.ItemDetail);

    renderIntakePage();

    const file = new File(['bytes'], 'existing-photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(getGalleryInput(), file);

    expect(await screen.findByLabelText('Name')).toHaveValue('Unknown item');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(file, undefined, true);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Unknown item', photoIds: ['photo-1'] }),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // AC 6 — a rejected selection (e.g. non-image / oversized, rejected by the
  // server) surfaces the existing error UI rather than a blank state, for
  // both the camera and gallery inputs.
  // ---------------------------------------------------------------------------
  it('AC6: a failed upload via the gallery input surfaces the error alert, not a blank state', async () => {
    mockDirectories();
    vi.spyOn(api, 'uploadPhoto').mockRejectedValue(
      new Error('Photo upload failed with status 413'),
    );

    renderIntakePage();

    const file = new File(['bytes'], 'too-big.jpg', { type: 'image/jpeg' });
    await userEvent.upload(getGalleryInput(), file);

    expect(await screen.findByText('Photo upload failed with status 413')).toBeInTheDocument();
    // Still on the photo step — not a blank state.
    expect(screen.getByRole('button', { name: /choose/i })).toBeInTheDocument();
  });
});
