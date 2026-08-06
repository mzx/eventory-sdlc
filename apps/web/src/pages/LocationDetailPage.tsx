import AddIcon from '@mui/icons-material/Add';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { fetchItems, fetchLocation, fetchLocations } from '../api';
import { ItemCard } from '../components/ItemCard';
import { QrThumb } from '../components/QrThumb';

/** Renders a materialized path like `garage.shelf-3` as `garage › shelf-3`. */
function humanPath(path: string): string {
  return path.replace(/\./g, ' › ');
}

/**
 * `/locations/:id` — breadcrumb, child locations as tappable cards, the
 * location's direct items (reusing `ItemCard`), a printable QR sticker block,
 * and an "Add item here" shortcut into intake with the location pre-selected.
 */
export function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const locationQuery = useQuery({
    queryKey: ['locations', id],
    queryFn: () => fetchLocation(id as string),
    enabled: Boolean(id),
  });

  // Reused to resolve ancestor breadcrumb segments and child item counts —
  // shares the ['locations'] cache with LocationsPage, so this is usually a
  // no-op fetch.
  const allLocationsQuery = useQuery({ queryKey: ['locations'], queryFn: fetchLocations });

  const itemsQuery = useQuery({
    queryKey: ['items', { locationId: id }],
    queryFn: () => fetchItems({ locationId: id as string }),
    enabled: Boolean(id),
  });

  if (locationQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (locationQuery.isError || !locationQuery.data) {
    return (
      <Alert severity="error">
        {locationQuery.error instanceof Error
          ? locationQuery.error.message
          : 'Failed to load location'}
      </Alert>
    );
  }

  const location = locationQuery.data;
  const pathToId = new Map((allLocationsQuery.data ?? []).map((loc) => [loc.path, loc.id]));
  const itemCountById = new Map(
    (allLocationsQuery.data ?? []).map((loc) => [loc.id, loc.itemCount]),
  );
  const items = itemsQuery.data ?? [];

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        separator={<NavigateNextIcon fontSize="small" />}
        aria-label="Location breadcrumb"
      >
        <Typography
          component={RouterLink}
          to="/locations"
          variant="body2"
          sx={{ color: 'text.secondary', textDecoration: 'none' }}
        >
          Locations
        </Typography>
        {location.breadcrumb.map((crumb, i) => {
          const isLast = i === location.breadcrumb.length - 1;
          const crumbId = pathToId.get(crumb.path);
          if (isLast || !crumbId) {
            return (
              <Typography key={crumb.path} variant="body2" color="text.primary">
                {crumb.segment}
              </Typography>
            );
          }
          return (
            <Typography
              key={crumb.path}
              component={RouterLink}
              to={`/locations/${crumbId}`}
              variant="body2"
              sx={{ color: 'text.secondary', textDecoration: 'none' }}
            >
              {crumb.segment}
            </Typography>
          );
        })}
      </Breadcrumbs>

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1}
      >
        <Typography variant="h5" component="h1">
          {location.name}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() =>
            navigate(`/intake?${new URLSearchParams({ locationId: location.id }).toString()}`)
          }
        >
          Add item here
        </Button>
      </Stack>

      {location.children.length > 0 && (
        <Box>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Child locations
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 2,
            }}
          >
            {location.children.map((child) => (
              <Card variant="outlined" key={child.id} data-testid="location-child-card">
                <CardActionArea onClick={() => navigate(`/locations/${child.id}`)}>
                  <CardContent>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <FolderOutlinedIcon color="action" fontSize="small" />
                      <Typography variant="subtitle2" noWrap>
                        {child.name}
                      </Typography>
                    </Stack>
                    <Chip
                      label={`${itemCountById.get(child.id) ?? 0} items`}
                      size="small"
                      variant="outlined"
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Box>
      )}

      <Divider />

      <Box>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Items in this location
        </Typography>

        {itemsQuery.isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {itemsQuery.isSuccess && items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No items placed directly in this location yet.
          </Typography>
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
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          QR sticker
        </Typography>
        <QrThumb token={location.qrCode} label={humanPath(location.path)} />
      </Box>
    </Stack>
  );
}
