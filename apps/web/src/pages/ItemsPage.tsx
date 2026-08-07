import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import ClearIcon from '@mui/icons-material/Clear';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { fetchItems, fetchTags, searchItemsByPhoto, type PhotoSearchResult } from '../api';
import { ItemCard } from '../components/ItemCard';

const SEARCH_DEBOUNCE_MS = 300;

/** Debounces a fast-changing value; returns the value once it has settled. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ItemsPage() {
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  // Photo search (EVT-17): while `photoSearch` is set, its `matches` replace
  // the normal browsing grid entirely; `fileInputRef` drives the hidden
  // `<input type=file>` the camera button triggers.
  const [photoSearch, setPhotoSearch] = useState<PhotoSearchResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: fetchTags });

  const itemsQuery = useQuery({
    queryKey: ['items', { search: debouncedSearch, tag: activeTag }],
    queryFn: () =>
      fetchItems({
        search: debouncedSearch || undefined,
        tag: activeTag ?? undefined,
      }),
  });

  const photoSearchMutation = useMutation({
    mutationFn: searchItemsByPhoto,
    onSuccess: (result) => setPhotoSearch(result),
  });

  const clearPhotoSearch = () => {
    setPhotoSearch(null);
    photoSearchMutation.reset();
  };

  // Any change to the text search input or a tag-chip toggle exits photo
  // search mode: without this, typing in the text box while photo matches
  // are shown left the grid pinned to the stale `photoSearch.matches` even
  // though `itemsQuery` had refetched underneath it (EVT-17 review round 2,
  // finding 2).
  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    if (photoSearch !== null) {
      clearPhotoSearch();
    }
  };

  const handleTagToggle = (tagName: string) => {
    setActiveTag(activeTag === tagName ? null : tagName);
    if (photoSearch !== null) {
      clearPhotoSearch();
    }
  };

  const handlePhotoSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again still fires onChange.
    e.target.value = '';
    if (file) {
      photoSearchMutation.mutate(file);
    }
  };

  const items = itemsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const hasActiveFilters = search.length > 0 || activeTag !== null;
  const isPhotoSearchActive = photoSearch !== null;
  const displayItems = isPhotoSearchActive ? photoSearch.matches : items;

  return (
    <Stack spacing={2}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="photo-search-input"
        onChange={handlePhotoSelected}
      />

      <TextField
        fullWidth
        size="small"
        placeholder="Search items…"
        value={search}
        onChange={handleSearchChange}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="Search by photo"
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoSearchMutation.isPending}
                >
                  <PhotoCameraOutlinedIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        inputProps={{ 'aria-label': 'Search items' }}
      />

      {photoSearchMutation.isPending && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {photoSearchMutation.isError && (
        <Alert severity="error" onClose={() => photoSearchMutation.reset()}>
          {photoSearchMutation.error instanceof Error
            ? photoSearchMutation.error.message
            : 'Failed to search by photo'}
        </Alert>
      )}

      {isPhotoSearchActive && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={clearPhotoSearch}>
              Clear search
            </Button>
          }
        >
          Looks like: {photoSearch.analysis.suggested_name}
        </Alert>
      )}

      {!isPhotoSearchActive && tags.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {hasActiveFilters && (
            <Chip
              label="Clear filters"
              icon={<ClearIcon fontSize="small" />}
              color="error"
              variant="outlined"
              onClick={() => {
                setSearch('');
                setActiveTag(null);
              }}
            />
          )}
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              label={`${tag.name} (${tag.itemCount})`}
              color={activeTag === tag.name ? 'primary' : 'default'}
              onClick={() => handleTagToggle(tag.name)}
              variant={activeTag === tag.name ? 'filled' : 'outlined'}
            />
          ))}
        </Stack>
      )}

      {!isPhotoSearchActive && itemsQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!isPhotoSearchActive && itemsQuery.isError && (
        <Alert severity="error">
          {itemsQuery.error instanceof Error ? itemsQuery.error.message : 'Failed to load items'}
        </Alert>
      )}

      {!isPhotoSearchActive && itemsQuery.isSuccess && items.length === 0 && !hasActiveFilters && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <AddPhotoAlternateOutlinedIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
          <Typography variant="h6" gutterBottom>
            No items yet
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Photograph something to add your first item.
          </Typography>
          <Typography variant="body2">
            <RouterLink to="/intake">Add item</RouterLink>
          </Typography>
        </Box>
      )}

      {!isPhotoSearchActive && itemsQuery.isSuccess && items.length === 0 && hasActiveFilters && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="body1" color="text.secondary">
            No items match your search.
          </Typography>
        </Box>
      )}

      {isPhotoSearchActive && displayItems.length === 0 && !photoSearchMutation.isPending && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="body1" color="text.secondary">
            No matching items found for this photo.
          </Typography>
        </Box>
      )}

      {displayItems.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 2,
          }}
        >
          {displayItems.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </Box>
      )}
    </Stack>
  );
}
