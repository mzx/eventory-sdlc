import AddIcon from '@mui/icons-material/Add';
import CollectionsOutlinedIcon from '@mui/icons-material/CollectionsOutlined';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  type SelectChangeEvent,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  createItem,
  fetchCategories,
  fetchItems,
  fetchLocations,
  fetchTags,
  photoUrl,
  receiveItem,
  uploadPhoto,
  type CategoryListItem,
  type ItemListRow,
  type LocationListItem,
  type PhotoSearchAnalysis,
  type UploadedPhoto,
} from '../api';
import { BarcodeScannerDialog } from '../components/BarcodeScannerDialog';
import { parseEciaBarcode, type ParsedEciaBarcode } from '../lib/eciaBarcode';

/**
 * The screens of the intake flow:
 * - `photo` — pick/skip a photo, or scan a distributor barcode (EVT-31).
 * - `barcode-match` — a scanned MPN matched an existing item; offers
 *   "add to existing" vs "create new anyway" (EVT-31 AC 4).
 * - `form` — confirm the (possibly AI- or barcode-drafted) form.
 */
type Step = 'photo' | 'barcode-match' | 'form';

/** One row of the dynamic properties (key/value) editor — mirrors EditItemPage. */
interface PropertyRow {
  /** Stable React key — properties are a plain object, not naturally keyed. */
  id: number;
  key: string;
  value: string;
}

let propertyRowSeq = 0;
function newPropertyRow(key = '', value = ''): PropertyRow {
  return { id: propertyRowSeq++, key, value };
}

/** Depth of a materialized-path entry, for indenting tree selects. */
function pathDepth(path: string): number {
  return path.split('.').length - 1;
}

/**
 * IntakePage — the signature "photograph a thing, confirm the AI draft,
 * done" flow (EVT-11). Two steps:
 *
 * 1. Photo: capture/choose a photo (or skip for manual entry), upload with
 *    `?analyze=true`, showing an "Analyzing…" state while Claude vision
 *    drafts the item.
 * 2. Form: the same fields as EditItemPage, prefilled from the AI draft
 *    when one came back. Saving POSTs the new item with the photo attached
 *    (it becomes the primary photo) and lands on ItemDetailPage.
 *
 * AI analysis never blocks saving: the server never throws for a failed/
 * refused/unavailable model call (it degrades to a stub), and if the
 * upload request itself fails outright (network/timeout) this page retries
 * as a plain, unanalyzed upload so the photo still attaches and the form
 * simply comes up empty instead of drafted.
 */
export function IntakePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedLocationId = searchParams.get('locationId') ?? '';

  const [step, setStep] = useState<Step>('photo');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedPhoto, setUploadedPhoto] = useState<UploadedPhoto | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [aiDraftApplied, setAiDraftApplied] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // Not seeded from `preselectedLocationId` directly — a crafted `?locationId=`
  // for a location that doesn't exist (or that this user can't see) must not
  // be silently submitted (MUI Select renders blank for unknown values, so
  // the user has no visual cue). Seeded only once `locationsQuery` resolves
  // and the id validates, via the effect below.
  const [locationId, setLocationId] = useState('');
  const [locationSeeded, setLocationSeeded] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [properties, setProperties] = useState<PropertyRow[]>([]);

  // --- Distributor barcode receiving (EVT-31) --------------------------
  const [barcodeDialogOpen, setBarcodeDialogOpen] = useState(false);
  const [barcodeDraftApplied, setBarcodeDraftApplied] = useState(false);
  const [barcodeLookupError, setBarcodeLookupError] = useState<string | null>(null);
  // Set when a scanned MPN/supplier-PN matches an existing item — drives
  // the `barcode-match` step (AC 4).
  const [barcodeMatch, setBarcodeMatch] = useState<{
    item: ItemListRow;
    parsed: ParsedEciaBarcode;
  } | null>(null);
  const [barcodeAddQuantity, setBarcodeAddQuantity] = useState(1);

  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: fetchTags });
  const locationsQuery = useQuery({ queryKey: ['locations'], queryFn: fetchLocations });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });

  // Revoke the previous preview object URL whenever it changes (retake) and
  // on unmount, so we don't leak blob URLs for every photo taken.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Seed `locationId` from `?locationId=` exactly once, and only if it
  // matches a location the user actually has access to.
  useEffect(() => {
    if (locationSeeded) return;
    if (!preselectedLocationId) {
      setLocationSeeded(true);
      return;
    }
    if (!locationsQuery.data) return; // wait for locations to load
    if (locationsQuery.data.some((l) => l.id === preselectedLocationId)) {
      setLocationId(preselectedLocationId);
    }
    setLocationSeeded(true);
  }, [locationSeeded, preselectedLocationId, locationsQuery.data]);

  /**
   * Prefills the form from an AI draft: `suggested_name` → name, `color`
   * merged into `properties`, `search_keywords` appended to `description`
   * so they stay searchable via the existing name/description/properties
   * ILIKE search (EVT-3) without a separate hidden field.
   */
  function applyAiDraft(analysis: PhotoSearchAnalysis) {
    setName(analysis.suggested_name ?? '');
    setTags(analysis.tags ?? []);
    if (analysis.quantity != null) setQuantity(analysis.quantity);
    setUnit(analysis.unit ?? '');
    const mergedProperties: Record<string, unknown> = { ...(analysis.properties ?? {}) };
    if (analysis.color) mergedProperties.color = analysis.color;
    setProperties(
      Object.entries(mergedProperties).map(([key, value]) => newPropertyRow(key, String(value))),
    );
    const keywords = analysis.search_keywords ?? [];
    const keywordSuffix = keywords.length > 0 ? `\n\nKeywords: ${keywords.join(', ')}` : '';
    setDescription(`${analysis.description ?? ''}${keywordSuffix}`);
    setAiDraftApplied(true);
  }

  /**
   * Prefills the draft from a parsed ECIA barcode scan (EVT-31 goal): name
   * from MPN (falling back to the customer/supplier part number, then the
   * raw scan text so there's never a blank name to stare at — AC 2 "no
   * dead ends"), quantity from `Q`, and `mpn`/`supplierPn`/`lot`/`dateCode`
   * as properties rows whenever the label actually carried them (AC 3).
   * Unlike `applyAiDraft`, only fields the label actually encoded are set —
   * a partial label leaves description/tags/unit blank and editable.
   */
  function applyBarcodeDraft(parsed: ParsedEciaBarcode) {
    setName(parsed.mpn || parsed.supplierPn || parsed.raw);
    if (parsed.quantity != null) setQuantity(parsed.quantity);
    const rows: PropertyRow[] = [];
    if (parsed.mpn) rows.push(newPropertyRow('mpn', parsed.mpn));
    if (parsed.supplierPn) rows.push(newPropertyRow('supplierPn', parsed.supplierPn));
    if (parsed.lot) rows.push(newPropertyRow('lot', parsed.lot));
    if (parsed.dateCode) rows.push(newPropertyRow('dateCode', parsed.dateCode));
    setProperties(rows);
    setBarcodeDraftApplied(true);
    setStep('form');
  }

  /**
   * True when `item`'s saved `mpn`/`supplierPn` properties exactly match
   * `identifier` (case-insensitive) — the "known MPN" check behind AC 4.
   * Deliberately exact, not substring: `fetchItems({ search })` itself is
   * an ILIKE substring match, so this narrows those candidates down to a
   * genuine re-scan of the same part rather than any item whose properties
   * happen to contain the identifier as a substring.
   */
  function matchesScannedIdentifier(item: ItemListRow, identifier: string): boolean {
    const props = item.properties as Record<string, unknown>;
    const needle = identifier.trim().toLowerCase();
    const mpn = typeof props.mpn === 'string' ? props.mpn.trim().toLowerCase() : undefined;
    const supplierPn =
      typeof props.supplierPn === 'string' ? props.supplierPn.trim().toLowerCase() : undefined;
    return mpn === needle || supplierPn === needle;
  }

  /**
   * Fired by `BarcodeScannerDialog` with the raw decoded text. Parses it
   * (AC 1/2), then checks for an existing item carrying the same MPN/
   * supplier-PN (AC 4) before falling back to prefilling a fresh draft.
   * A lookup failure (network) doesn't block the scan — it just skips
   * straight to the fresh-draft path, same "never block on a convenience
   * check" principle as `uploadMutation`'s AI-analysis fallback.
   */
  async function handleBarcodeDecoded(text: string) {
    setBarcodeDialogOpen(false);
    setBarcodeLookupError(null);
    const parsed = parseEciaBarcode(text);
    const identifier = parsed.mpn ?? parsed.supplierPn;

    if (identifier) {
      try {
        const candidates = await fetchItems({ search: identifier });
        const match = candidates.find((item) => matchesScannedIdentifier(item, identifier));
        if (match) {
          setBarcodeMatch({ item: match, parsed });
          setBarcodeAddQuantity(parsed.quantity ?? 1);
          setStep('barcode-match');
          return;
        }
      } catch {
        setBarcodeLookupError('Could not check for an existing item — continuing as new.');
      }
    }

    applyBarcodeDraft(parsed);
  }

  /** "Create new item instead" on the barcode-match screen (AC 4 alternative). */
  function createNewFromBarcodeMatch() {
    if (!barcodeMatch) return;
    const parsed = barcodeMatch.parsed;
    setBarcodeMatch(null);
    applyBarcodeDraft(parsed);
  }

  const receiveMutation = useMutation({
    mutationFn: () => {
      if (!barcodeMatch) {
        throw new Error('No matched item to receive against');
      }
      return receiveItem(barcodeMatch.item.id, barcodeAddQuantity);
    },
    onSuccess: (item) => {
      navigate(`/items/${item.id}`);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      try {
        return await uploadPhoto(file, undefined, true);
      } catch {
        // The analyzed upload failed outright (network/timeout — the server
        // itself never throws for a failed/refused/unavailable model call,
        // it degrades to a stub) — retry as a plain upload so the photo is
        // still attached and the flow never blocks on AI (AC 3).
        return await uploadPhoto(file, undefined, false);
      }
    },
    onSuccess: (photo) => {
      setUploadError(null);
      setUploadedPhoto(photo);
      if (photo.aiAnalysis) {
        applyAiDraft(photo.aiAnalysis);
      }
      setStep('form');
    },
    onError: (error: unknown) => {
      setUploadError(error instanceof Error ? error.message : 'Failed to upload photo');
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      createItem({
        name,
        description,
        quantity,
        unit,
        tags,
        locationId: locationId || undefined,
        categoryId: categoryId || undefined,
        properties: Object.fromEntries(
          properties.filter((p) => p.key.trim().length > 0).map((p) => [p.key.trim(), p.value]),
        ),
        photoIds: uploadedPhoto ? [uploadedPhoto.id] : undefined,
      }),
    onSuccess: (item) => {
      // `justCreated` drives the "Print QR" toast on ItemDetailPage.
      navigate(`/items/${item.id}`, { state: { justCreated: true } });
    },
  });

  /**
   * Shared handler for both the "Take photo" (camera capture) and "Choose
   * image" (gallery/file picker) inputs — an existing image flows through
   * the identical upload → AI draft → confirm pipeline as a captured one,
   * with no separate code path beyond acquisition (AC 2).
   */
  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setPreviewUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
    uploadMutation.mutate(file);
  }

  function skipPhoto() {
    setUploadedPhoto(null);
    setUploadError(null);
    setStep('form');
  }

  function addPropertyRow() {
    setProperties((rows) => [...rows, newPropertyRow()]);
  }

  function updatePropertyRow(id: number, field: 'key' | 'value', value: string) {
    setProperties((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removePropertyRow(id: number) {
    setProperties((rows) => rows.filter((r) => r.id !== id));
  }

  const locations = locationsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const tagOptions = (tagsQuery.data ?? []).map((t) => t.name);

  if (step === 'photo') {
    return (
      <Stack spacing={3} sx={{ maxWidth: 480 }}>
        <Typography variant="h5" component="h1">
          Add item
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Photograph the item — Eventory drafts the details, you confirm before saving.
        </Typography>

        {previewUrl && (
          <Box
            component="img"
            src={previewUrl}
            alt="Selected photo preview"
            sx={{
              width: '100%',
              maxHeight: 320,
              objectFit: 'contain',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
            }}
          />
        )}

        {uploadMutation.isPending && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={20} />
            <Typography variant="body2">Analyzing…</Typography>
          </Stack>
        )}

        {uploadError && <Alert severity="error">{uploadError}</Alert>}
        {barcodeLookupError && <Alert severity="warning">{barcodeLookupError}</Alert>}

        {/* Camera capture — forces the rear camera on mobile via `capture`. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handleFileSelected}
        />

        {/* Gallery/file picker — no `capture` attribute, so mobile browsers
            offer the photo library / file system instead of forcing the
            camera (AC 1). Feeds the identical upload pipeline (AC 2). */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFileSelected}
        />

        {/* Column-stacked (full-width buttons) below `sm` — the uppercase
            mono button font needs 400-500px+ for these three labels to sit
            on one row without crushing into fragments (2026-08-14 mobile
            audit finding #5); row layout returns once there's room. */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Button
            variant="contained"
            startIcon={<PhotoCameraOutlinedIcon />}
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {previewUrl ? 'Retake photo' : 'Take photo'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<CollectionsOutlinedIcon />}
            onClick={() => galleryInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {previewUrl ? 'Choose different image' : 'Choose image'}
          </Button>
          <Button
            onClick={skipPhoto}
            disabled={uploadMutation.isPending}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Skip photo
          </Button>
        </Stack>

        {/* Distributor barcode receiving (EVT-31): a separate path from
            photo capture — decodes a Data Matrix/PDF417 label instead of
            photographing the item. */}
        <Button
          variant="outlined"
          startIcon={<QrCodeScannerOutlinedIcon />}
          onClick={() => setBarcodeDialogOpen(true)}
          disabled={uploadMutation.isPending}
        >
          Scan supplier barcode
        </Button>

        <BarcodeScannerDialog
          open={barcodeDialogOpen}
          onClose={() => setBarcodeDialogOpen(false)}
          onDecoded={(text) => {
            void handleBarcodeDecoded(text);
          }}
        />
      </Stack>
    );
  }

  if (step === 'barcode-match' && barcodeMatch) {
    const match = barcodeMatch;
    return (
      <Stack spacing={3} sx={{ maxWidth: 480 }}>
        <Typography variant="h5" component="h1">
          Already in inventory
        </Typography>
        <Alert severity="info">
          This barcode matches an existing item — add to it instead of creating a duplicate?
        </Alert>

        <Box>
          <Typography variant="subtitle1">{match.item.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            Currently {match.item.quantity} {match.item.unit || 'on hand'}
            {match.item.location ? ` · ${match.item.location.name}` : ''}
          </Typography>
        </Box>

        <TextField
          label="Quantity to add"
          type="number"
          value={barcodeAddQuantity}
          onChange={(e) => setBarcodeAddQuantity(Math.max(1, Number(e.target.value)))}
          inputProps={{ min: 1 }}
        />

        {receiveMutation.isError && (
          <Alert severity="error">
            {receiveMutation.error instanceof Error
              ? receiveMutation.error.message
              : 'Failed to add to existing item'}
          </Alert>
        )}

        {/* Same column-stacking rationale as the photo-step row above
            (finding #5) — "Create new item instead" alone needs ~230px. */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Button
            variant="contained"
            onClick={() => receiveMutation.mutate()}
            disabled={receiveMutation.isPending || barcodeAddQuantity < 1}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Add to existing
          </Button>
          <Button
            onClick={createNewFromBarcodeMatch}
            disabled={receiveMutation.isPending}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Create new item instead
          </Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="h5" component="h1">
        Add item
      </Typography>

      {uploadedPhoto && (
        <Box
          component="img"
          src={photoUrl(uploadedPhoto.filename)}
          alt="Item photo"
          sx={{
            width: 160,
            height: 120,
            objectFit: 'cover',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
          }}
        />
      )}

      {aiDraftApplied && <Alert severity="info">AI draft — check before saving</Alert>}
      {barcodeDraftApplied && <Alert severity="info">Barcode scan — check before saving</Alert>}

      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />

      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        multiline
        minRows={2}
      />

      <Stack direction="row" spacing={2}>
        <TextField
          label="Quantity"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))}
          fullWidth
          inputProps={{ min: 0 }}
        />
        <TextField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} fullWidth />
      </Stack>

      <Autocomplete
        multiple
        freeSolo
        options={tagOptions}
        value={tags}
        onChange={(_e, value) => setTags(value)}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => {
            const { key, ...tagProps } = getTagProps({ index });
            return <Chip key={key} label={option} size="small" {...tagProps} />;
          })
        }
        renderInput={(params) => <TextField {...params} label="Tags" placeholder="Add a tag" />}
      />

      <FormControl fullWidth>
        <InputLabel id="location-label">Location</InputLabel>
        <Select
          labelId="location-label"
          label="Location"
          value={locationId}
          onChange={(e: SelectChangeEvent) => setLocationId(e.target.value)}
        >
          <MenuItem value="">
            <em>No location</em>
          </MenuItem>
          {locations.map((loc: LocationListItem) => (
            <MenuItem key={loc.id} value={loc.id} sx={{ pl: 2 + pathDepth(loc.path) * 2 }}>
              {loc.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth>
        <InputLabel id="category-label">Category</InputLabel>
        <Select
          labelId="category-label"
          label="Category"
          value={categoryId}
          onChange={(e: SelectChangeEvent) => setCategoryId(e.target.value)}
        >
          <MenuItem value="">
            <em>No category</em>
          </MenuItem>
          {categories.map((cat: CategoryListItem) => (
            <MenuItem key={cat.id} value={cat.id} sx={{ pl: 2 + pathDepth(cat.path) * 2 }}>
              {cat.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box>
        <Typography variant="subtitle1" gutterBottom>
          Properties
        </Typography>
        <Stack spacing={1}>
          {properties.map((row) => (
            <Stack key={row.id} direction="row" spacing={1} alignItems="center">
              <TextField
                label="Key"
                size="small"
                value={row.key}
                onChange={(e) => updatePropertyRow(row.id, 'key', e.target.value)}
              />
              <TextField
                label="Value"
                size="small"
                value={row.value}
                onChange={(e) => updatePropertyRow(row.id, 'value', e.target.value)}
                fullWidth
              />
              <IconButton
                aria-label={`Remove property ${row.key || row.id}`}
                onClick={() => removePropertyRow(row.id)}
              >
                <RemoveCircleOutlineIcon />
              </IconButton>
            </Stack>
          ))}
          <Button startIcon={<AddIcon />} onClick={addPropertyRow} sx={{ alignSelf: 'flex-start' }}>
            Add property
          </Button>
        </Stack>
      </Box>

      {saveMutation.isError && (
        <Alert severity="error">
          {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save item'}
        </Alert>
      )}

      <Stack direction="row" spacing={2}>
        <Button
          variant="contained"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || name.trim().length === 0}
        >
          Save
        </Button>
        <Button onClick={() => navigate('/')} disabled={saveMutation.isPending}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}
