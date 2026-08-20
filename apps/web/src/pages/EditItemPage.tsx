import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deletePhoto,
  fetchCategories,
  fetchItem,
  fetchLocations,
  fetchTags,
  photoUrl,
  updateItem,
  uploadPhoto,
  type CategoryListItem,
  type LocationListItem,
} from '../api';
import { wsKey } from '../lib/queryKeys';
import { READ_ONLY_HINT, useActiveWorkspaceId, useIsViewer } from '../workspace/useActiveWorkspace';

/** One row of the dynamic properties (key/value) editor. */
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

export function EditItemPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const isViewer = useIsViewer();

  const itemQuery = useQuery({
    queryKey: wsKey(workspaceId, 'items', id),
    queryFn: () => fetchItem(id as string),
    enabled: Boolean(id) && workspaceId != null,
  });
  const tagsQuery = useQuery({
    queryKey: wsKey(workspaceId, 'tags'),
    queryFn: fetchTags,
    enabled: workspaceId != null,
  });
  const locationsQuery = useQuery({
    queryKey: wsKey(workspaceId, 'locations'),
    queryFn: fetchLocations,
    enabled: workspaceId != null,
  });
  const categoriesQuery = useQuery({
    queryKey: wsKey(workspaceId, 'categories'),
    queryFn: fetchCategories,
    enabled: workspaceId != null,
  });

  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  /** Replenishment threshold (EVT-26). Empty string = no tracking (`null`). */
  const [minQuantity, setMinQuantity] = useState('');
  /** Count cadence in days (EVT-27). Empty string = not on a count schedule (`null`). */
  const [countIntervalDays, setCountIntervalDays] = useState('');
  /** Manual "last verified" override (EVT-27). Empty string = clear to "never verified" (`null`). */
  const [lastVerifiedAt, setLastVerifiedAt] = useState('');
  const [unit, setUnit] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [locationId, setLocationId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [photoActionError, setPhotoActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seed local form state once, the first time the item loads.
  useEffect(() => {
    if (itemQuery.data && !initialized) {
      const item = itemQuery.data;
      setName(item.name);
      setDescription(item.description ?? '');
      setQuantity(item.quantity);
      setMinQuantity(item.minQuantity != null ? String(item.minQuantity) : '');
      setCountIntervalDays(item.countIntervalDays != null ? String(item.countIntervalDays) : '');
      // `lastVerifiedAt` is an ISO datetime; the <input type="date"> control
      // only accepts the "YYYY-MM-DD" prefix.
      setLastVerifiedAt(item.lastVerifiedAt ? item.lastVerifiedAt.slice(0, 10) : '');
      setUnit(item.unit ?? '');
      setTags(item.tags.map((t) => t.tag.name));
      setLocationId(item.locationId ?? '');
      setCategoryId(item.categoryId ?? '');
      setProperties(
        Object.entries(item.properties ?? {}).map(([key, value]) =>
          newPropertyRow(key, String(value)),
        ),
      );
      setInitialized(true);
    }
  }, [itemQuery.data, initialized]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateItem(id as string, {
        name,
        description,
        quantity,
        // Empty string ("no replenishment tracking") must send an explicit
        // `null`, same undefined-vs-null convention as locationId/categoryId
        // below — omitting the key would leave a previously-set threshold
        // unchanged instead of clearing it.
        minQuantity: minQuantity.trim() === '' ? null : Number(minQuantity),
        // Same undefined-vs-null convention as minQuantity above — an empty
        // field explicitly clears the count schedule / verified date rather
        // than leaving a previously-set value untouched.
        countIntervalDays: countIntervalDays.trim() === '' ? null : Number(countIntervalDays),
        lastVerifiedAt: lastVerifiedAt.trim() === '' ? null : lastVerifiedAt,
        unit,
        tags,
        // Empty string ("No location"/"No category" selected) must send an
        // explicit `null` — sending `undefined` drops the key from the JSON
        // body entirely, which the server treats as "leave unchanged" rather
        // than "clear the relation".
        locationId: locationId || null,
        categoryId: categoryId || null,
        properties: Object.fromEntries(
          properties.filter((p) => p.key.trim().length > 0).map((p) => [p.key.trim(), p.value]),
        ),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'items') });
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'tags') });
      navigate(`/items/${id}`);
    },
  });

  function handlePhotoActionError(error: unknown, fallback: string) {
    setPhotoActionError(error instanceof Error ? error.message : fallback);
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPhoto(file, id as string),
    onSuccess: () => {
      setPhotoActionError(null);
      // Invalidate the broader `['items']` prefix (not just `['items', id]`)
      // so the items LIST — which renders thumbnails from `primaryPhoto` and
      // is keyed as `['items', { search, tag }]` on ItemsPage — picks up a
      // newly auto-promoted primary photo (EVT-24 AC1) without a full
      // reload, matching setPrimaryMutation/removePhotoMutation below.
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'items') });
    },
    onError: (error: unknown) => handlePhotoActionError(error, 'Failed to upload photo'),
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (photoId: string) => updateItem(id as string, { photoIds: [photoId] }),
    onSuccess: () => {
      setPhotoActionError(null);
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'items') });
    },
    onError: (error: unknown) => handlePhotoActionError(error, 'Failed to set primary photo'),
  });

  const removePhotoMutation = useMutation({
    mutationFn: (photoId: string) => deletePhoto(photoId),
    onSuccess: () => {
      setPhotoActionError(null);
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'items') });
    },
    onError: (error: unknown) => handlePhotoActionError(error, 'Failed to remove photo'),
  });

  if (itemQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (itemQuery.isError || !itemQuery.data) {
    return (
      <Alert severity="error">
        {itemQuery.error instanceof Error ? itemQuery.error.message : 'Failed to load item'}
      </Alert>
    );
  }

  const item = itemQuery.data;
  const locations = locationsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const tagOptions = (tagsQuery.data ?? []).map((t) => t.name);

  function addPropertyRow() {
    setProperties((rows) => [...rows, newPropertyRow()]);
  }

  function updatePropertyRow(id: number, field: 'key' | 'value', value: string) {
    setProperties((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removePropertyRow(id: number) {
    setProperties((rows) => rows.filter((r) => r.id !== id));
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="h5" component="h1">
        Edit {item.name}
      </Typography>

      {isViewer && <Alert severity="info">{READ_ONLY_HINT}</Alert>}

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

      <TextField
        label="Minimum quantity"
        helperText="Optional. When on-hand drops to this level or below, Eventory adds it to the shopping list automatically."
        type="number"
        value={minQuantity}
        onChange={(e) => setMinQuantity(e.target.value)}
        inputProps={{ min: 0 }}
      />

      <Stack direction="row" spacing={2}>
        <TextField
          label="Count interval (days)"
          helperText="Optional. Puts this item on the verification queue once this many days pass since it was last counted."
          type="number"
          value={countIntervalDays}
          onChange={(e) => setCountIntervalDays(e.target.value)}
          inputProps={{ min: 1 }}
          fullWidth
        />
        <TextField
          label="Last verified"
          helperText="Set automatically by a count; correct it here if it's wrong."
          type="date"
          value={lastVerifiedAt}
          onChange={(e) => setLastVerifiedAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          fullWidth
        />
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

      <Box>
        <Typography variant="subtitle1" gutterBottom>
          Photos
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {item.photos.map((photo) => (
            <Box key={photo.id} sx={{ position: 'relative' }}>
              <Box
                component="img"
                src={photoUrl(photo.filename)}
                alt={item.name}
                sx={{
                  width: 120,
                  height: 90,
                  objectFit: 'cover',
                  borderRadius: 1,
                  border: photo.id === item.primaryPhotoId ? 2 : 1,
                  borderColor: photo.id === item.primaryPhotoId ? 'primary.main' : 'divider',
                }}
              />
              <Stack direction="row" sx={{ position: 'absolute', top: 0, right: 0 }}>
                <IconButton
                  size="small"
                  aria-label={
                    photo.id === item.primaryPhotoId ? 'Primary photo' : 'Set as primary photo'
                  }
                  onClick={() => setPrimaryMutation.mutate(photo.id)}
                  disabled={photo.id === item.primaryPhotoId}
                >
                  {photo.id === item.primaryPhotoId ? (
                    <StarIcon fontSize="small" color="primary" />
                  ) : (
                    <StarBorderIcon fontSize="small" />
                  )}
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Remove photo"
                  onClick={() => removePhotoMutation.mutate(photo.id)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          ))}
        </Stack>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadMutation.mutate(file);
            e.target.value = '';
          }}
        />
        <Button
          startIcon={<PhotoCameraOutlinedIcon />}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          sx={{ mt: 1 }}
        >
          Add photo
        </Button>
        {photoActionError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {photoActionError}
          </Alert>
        )}
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
          disabled={isViewer || saveMutation.isPending || name.trim().length === 0}
        >
          Save
        </Button>
        <Button onClick={() => navigate(`/items/${id}`)}>Cancel</Button>
      </Stack>
    </Stack>
  );
}
