import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { IntakePage } from './IntakePage';

// `BarcodeScannerDialog` owns real camera/decoder wiring, covered by its own
// unit tests — stubbed here to a single button that fires `onDecoded` with a
// test-controlled payload, so IntakePage's tests exercise the ECIA-parse +
// draft-prefill + existing-item-lookup wiring in isolation.
let onDecodedSpy: ((text: string) => void) | undefined;
vi.mock('../components/BarcodeScannerDialog', () => ({
  BarcodeScannerDialog: ({
    open,
    onDecoded,
  }: {
    open: boolean;
    onClose: () => void;
    onDecoded: (text: string) => void;
  }) => {
    onDecodedSpy = onDecoded;
    return open ? <div data-testid="barcode-scanner-dialog-stub" /> : null;
  },
}));

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

  // ---------------------------------------------------------------------------
  // EVT-37 finding #5 — photo-step and barcode-match action rows stack
  // (rather than crush into multi-line fragments) below the `sm` breakpoint.
  // `Stack`'s responsive `direction` prop renders the smallest ("xs") value
  // as the unconditional base CSS rule and the `sm` value behind a
  // `min-width` media query — asserting `flexDirection: column` here
  // confirms the base (narrow-viewport) rule really is "stacked", the exact
  // CSS jsdom resolves for an un-media-gated computed style.
  // ---------------------------------------------------------------------------
  describe('EVT-37: mobile action-row stacking', () => {
    it('AC1: the photo-step action row stacks (column) rather than a single non-wrapping row', async () => {
      mockDirectories();
      renderIntakePage();

      const takePhotoButton = await screen.findByRole('button', { name: /take photo/i });
      const row = takePhotoButton.parentElement;
      expect(row).toHaveStyle({ flexDirection: 'column' });
      // Every button in the row is still present and reachable.
      expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /choose image/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Skip photo' })).toBeInTheDocument();
    });

    it('AC1: the barcode-match action row stacks (column) rather than a single non-wrapping row', async () => {
      mockDirectories();
      vi.spyOn(api, 'fetchItems').mockResolvedValue([
        {
          id: 'existing-item-1',
          name: 'RC0402FR-071KL',
          description: null,
          quantity: 100,
          minQuantity: null,
          unit: null,
          properties: { mpn: 'RC0402FR-071KL' },
          qrCode: 'qr-existing',
          locationId: null,
          categoryId: null,
          primaryPhotoId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          tags: [],
          location: null,
          primaryPhoto: null,
        },
      ]);

      renderIntakePage();
      await userEvent.click(screen.getByRole('button', { name: /scan supplier barcode/i }));
      await waitFor(() => expect(onDecodedSpy).toBeDefined());
      const RS = '\x1E';
      const GS = '\x1D';
      const EOT = '\x04';
      await act(async () => {
        onDecodedSpy?.(`[)>${RS}06${GS}1PRC0402FR-071KL${GS}Q50${GS}${RS}${EOT}`);
      });

      const addToExisting = await screen.findByRole('button', { name: 'Add to existing' });
      const row = addToExisting.parentElement;
      expect(row).toHaveStyle({ flexDirection: 'column' });
      expect(screen.getByRole('button', { name: 'Create new item instead' })).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // EVT-31 — distributor barcode receiving
  // ---------------------------------------------------------------------------
  describe('EVT-31: distributor barcode receiving', () => {
    const RS = '\x1E';
    const GS = '\x1D';
    const EOT = '\x04';

    /** Builds a full ISO/IEC 15434-enveloped ECIA scan from GS-delimited fields. */
    function envelope(...fields: string[]): string {
      return `[)>${RS}06${GS}${fields.join(GS)}${GS}${RS}${EOT}`;
    }

    function itemRow(overrides: Partial<api.ItemListRow> = {}): api.ItemListRow {
      return {
        id: 'existing-item-1',
        name: 'RC0402FR-071KL',
        description: null,
        quantity: 100,
        minQuantity: null,
        unit: null,
        properties: {},
        qrCode: 'qr-existing',
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

    async function openBarcodeScanner() {
      await userEvent.click(screen.getByRole('button', { name: /scan supplier barcode/i }));
      await waitFor(() => expect(onDecodedSpy).toBeDefined());
    }

    /** Fires the stubbed `onDecoded` callback, flushed like a real event. */
    async function decode(text: string) {
      await act(async () => {
        onDecodedSpy?.(text);
      });
    }

    // -----------------------------------------------------------------------
    // AC 1 — a full DigiKey-style vector decodes and prefills MPN, quantity,
    // and lot into the draft.
    // -----------------------------------------------------------------------
    it('AC1: decodes a full ECIA vector and prefills MPN, quantity, and lot', async () => {
      mockDirectories();
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      const uploadMock = vi.spyOn(api, 'uploadPhoto');

      renderIntakePage();
      await openBarcodeScanner();

      await decode(envelope('P296-1234-1-ND', '1PRC0402FR-071KL', 'Q100', '1TWK2312'));

      expect(await screen.findByLabelText('Name')).toHaveValue('RC0402FR-071KL');
      expect(screen.getByLabelText('Quantity')).toHaveValue(100);
      const keys = screen.getAllByLabelText('Key').map((el) => (el as HTMLInputElement).value);
      const values = screen.getAllByLabelText('Value').map((el) => (el as HTMLInputElement).value);
      expect(keys).toEqual(expect.arrayContaining(['mpn', 'supplierPn', 'lot']));
      expect(values).toEqual(expect.arrayContaining(['RC0402FR-071KL', '296-1234-1-ND', 'WK2312']));
      expect(screen.getByText('Barcode scan — check before saving')).toBeInTheDocument();
      // Decoding is client-side only — no photo/image upload happens for
      // this path (AC 5).
      expect(uploadMock).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // AC 2 — a partial label leaves missing fields undefined/editable
    // instead of erroring or dead-ending.
    // -----------------------------------------------------------------------
    it('AC2: a partial label prefills only what it carries and leaves the rest editable', async () => {
      mockDirectories();
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);

      renderIntakePage();
      await openBarcodeScanner();

      await decode(envelope('1PRC0402FR-071KL', 'Q25'));

      expect(await screen.findByLabelText('Name')).toHaveValue('RC0402FR-071KL');
      expect(screen.getByLabelText('Quantity')).toHaveValue(25);
      // No lot/date/supplierPn rows were added — just the one recognized field.
      const keys = screen.getAllByLabelText('Key').map((el) => (el as HTMLInputElement).value);
      expect(keys).toEqual(['mpn']);

      // Still fully editable — e.g. the user can add a description by hand.
      const description = screen.getByLabelText('Description');
      await userEvent.type(description, 'Found in the SMD bin');
      expect(description).toHaveValue('Found in the SMD bin');
    });

    // -----------------------------------------------------------------------
    // AC 3 — saved items carry mpn/supplierPn/lot/dateCode in properties.
    // -----------------------------------------------------------------------
    it('AC3: saves mpn/supplierPn/lot/dateCode into item properties', async () => {
      mockDirectories();
      vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
      const createMock = vi.spyOn(api, 'createItem').mockResolvedValue({
        id: 'new-item-1',
      } as api.ItemDetail);

      renderIntakePage();
      await openBarcodeScanner();

      await decode(envelope('P296-1234-1-ND', '1PRC0402FR-071KL', 'Q100', '1TWK2312', '9D231106'));

      await screen.findByLabelText('Name');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(createMock).toHaveBeenCalledWith(
          expect.objectContaining({
            properties: {
              mpn: 'RC0402FR-071KL',
              supplierPn: '296-1234-1-ND',
              lot: 'WK2312',
              dateCode: '231106',
            },
          }),
        ),
      );
    });

    // -----------------------------------------------------------------------
    // AC 4 — re-scanning a known MPN offers "add to existing"; choosing it
    // records an add movement (via receiveItem) instead of creating a
    // duplicate item.
    // -----------------------------------------------------------------------
    it('AC4: offers add-to-existing for a known MPN, and adding records a movement instead of creating a duplicate', async () => {
      mockDirectories();
      const existing = itemRow({ properties: { mpn: 'RC0402FR-071KL' } });
      vi.spyOn(api, 'fetchItems').mockResolvedValue([existing]);
      const createMock = vi.spyOn(api, 'createItem');
      const receiveMock = vi.spyOn(api, 'receiveItem').mockResolvedValue({
        id: existing.id,
      } as api.ItemDetail);

      renderIntakePage();
      await openBarcodeScanner();

      await decode(envelope('1PRC0402FR-071KL', 'Q50'));

      expect(await screen.findByText('Already in inventory')).toBeInTheDocument();
      expect(screen.getByText(existing.name)).toBeInTheDocument();
      expect(screen.getByLabelText('Quantity to add')).toHaveValue(50);

      await userEvent.click(screen.getByRole('button', { name: 'Add to existing' }));

      await waitFor(() => expect(receiveMock).toHaveBeenCalledWith(existing.id, 50));
      expect(createMock).not.toHaveBeenCalled();
      expect(await screen.findByText('detail page')).toBeInTheDocument();
    });

    it('AC4: "Create new item instead" on the match screen falls back to the normal prefilled draft', async () => {
      mockDirectories();
      const existing = itemRow({ properties: { mpn: 'RC0402FR-071KL' } });
      vi.spyOn(api, 'fetchItems').mockResolvedValue([existing]);
      const receiveMock = vi.spyOn(api, 'receiveItem');

      renderIntakePage();
      await openBarcodeScanner();

      await decode(envelope('1PRC0402FR-071KL', 'Q50'));

      await screen.findByText('Already in inventory');
      await userEvent.click(screen.getByRole('button', { name: 'Create new item instead' }));

      expect(await screen.findByLabelText('Name')).toHaveValue('RC0402FR-071KL');
      expect(screen.getByLabelText('Quantity')).toHaveValue(50);
      expect(receiveMock).not.toHaveBeenCalled();
    });

    it('does not offer add-to-existing when no saved item carries a matching mpn/supplierPn', async () => {
      mockDirectories();
      // Substring hit from fetchItems' ILIKE search, but not an exact
      // mpn/supplierPn match — must NOT be treated as a re-scan.
      vi.spyOn(api, 'fetchItems').mockResolvedValue([
        itemRow({ properties: { mpn: 'RC0402FR-071KL-BULK' } }),
      ]);

      renderIntakePage();
      await openBarcodeScanner();

      await decode(envelope('1PRC0402FR-071KL', 'Q50'));

      expect(await screen.findByLabelText('Name')).toHaveValue('RC0402FR-071KL');
      expect(screen.queryByText('Already in inventory')).not.toBeInTheDocument();
    });
  });
});
