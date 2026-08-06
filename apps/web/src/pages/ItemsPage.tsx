import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { fetchItems, fetchTags } from '../api';
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

  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: fetchTags });

  const itemsQuery = useQuery({
    queryKey: ['items', { search: debouncedSearch, tag: activeTag }],
    queryFn: () =>
      fetchItems({
        search: debouncedSearch || undefined,
        tag: activeTag ?? undefined,
      }),
  });

  const items = itemsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const hasActiveFilters = search.length > 0 || activeTag !== null;

  return (
    <Stack spacing={2}>
      <TextField
        fullWidth
        size="small"
        placeholder="Search items…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        inputProps={{ 'aria-label': 'Search items' }}
      />

      {tags.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              label={`${tag.name} (${tag.itemCount})`}
              color={activeTag === tag.name ? 'primary' : 'default'}
              onClick={() => setActiveTag(activeTag === tag.name ? null : tag.name)}
              variant={activeTag === tag.name ? 'filled' : 'outlined'}
            />
          ))}
          {hasActiveFilters && (
            <Chip
              label="Clear filters"
              onClick={() => {
                setSearch('');
                setActiveTag(null);
              }}
            />
          )}
        </Stack>
      )}

      {itemsQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {itemsQuery.isError && (
        <Alert severity="error">
          {itemsQuery.error instanceof Error ? itemsQuery.error.message : 'Failed to load items'}
        </Alert>
      )}

      {itemsQuery.isSuccess && items.length === 0 && !hasActiveFilters && (
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

      {itemsQuery.isSuccess && items.length === 0 && hasActiveFilters && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="body1" color="text.secondary">
            No items match your search.
          </Typography>
        </Box>
      )}

      {items.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 2,
          }}
        >
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </Box>
      )}
    </Stack>
  );
}
