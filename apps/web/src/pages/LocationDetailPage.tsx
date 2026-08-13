import AddIcon from '@mui/icons-material/Add';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  fetchContainerMovements,
  fetchItems,
  fetchLocation,
  fetchLocations,
  moveLocation,
  type ContainerMovementRow,
  type LocationKind,
  type LocationListItem,
} from '../api';
import { ItemCard } from '../components/ItemCard';
import { QrThumb } from '../components/QrThumb';
import { formatRelativeTime } from '../lib/relativeTime';

/** Renders a materialized path like `garage.shelf-3` as `garage › shelf-3`. */
function humanPath(path: string): string {
  return path.replace(/\./g, ' › ');
}

/** Depth of a materialized-path entry, for indenting the destination picker. */
function pathDepth(path: string): number {
  return path.split('.').length - 1;
}

/** Distinct icon per `Location.kind` (EVT-30 AC 5) — missing `kind` falls back to `area`. */
function KindIcon({ kind, ...props }: { kind?: LocationKind; fontSize?: 'small' | 'inherit' }) {
  return kind === 'container' ? (
    <Inventory2OutlinedIcon color="action" aria-label="Container" {...props} />
  ) : (
    <FolderOutlinedIcon color="action" aria-label="Area" {...props} />
  );
}

/**
 * Every location this container is legally allowed to move into: excludes
 * itself and every one of its own descendants (path-prefix match) — a
 * client-side mirror of the server's ancestry guard (EVT-30 AC 4). The
 * server re-validates regardless; this only keeps obviously-invalid options
 * out of the picker.
 */
function validMoveTargets(all: LocationListItem[], container: { id: string; path: string }) {
  const descendantPrefix = `${container.path}.`;
  return all
    .filter((loc) => loc.id !== container.id && !loc.path.startsWith(descendantPrefix))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** "Move to…" dialog (EVT-30 AC 2) — a destination picker + confirm/cancel. */
function MoveContainerDialog({
  open,
  onClose,
  container,
  destinations,
}: {
  open: boolean;
  onClose: () => void;
  container: { id: string; name: string; parentId: string | null };
  destinations: LocationListItem[];
}) {
  const queryClient = useQueryClient();
  const [toParentId, setToParentId] = useState<string>(container.parentId ?? '');

  const moveMutation = useMutation({
    mutationFn: (target: string) => moveLocation(container.id, target || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['locations', container.id, 'movements'] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Move &quot;{container.name}&quot;</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1 }}>
          <InputLabel id="move-destination-label">Destination</InputLabel>
          <Select
            labelId="move-destination-label"
            label="Destination"
            value={toParentId}
            onChange={(e: SelectChangeEvent) => setToParentId(e.target.value)}
          >
            <MenuItem value="">
              <em>No location (root)</em>
            </MenuItem>
            {destinations.map((loc) => (
              <MenuItem key={loc.id} value={loc.id} sx={{ pl: 2 + pathDepth(loc.path) * 2 }}>
                {loc.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {moveMutation.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {moveMutation.error instanceof Error
              ? moveMutation.error.message
              : 'Failed to move this container'}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={moveMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={moveMutation.isPending}
          onClick={() => moveMutation.mutate(toParentId)}
        >
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One row of a container's own move history (EVT-30 AC 3) — never a per-item entry. */
function ContainerMovementListItem({ movement }: { movement: ContainerMovementRow }) {
  return (
    <ListItem disableGutters alignItems="flex-start">
      <ListItemIcon sx={{ minWidth: 36 }}>
        <SwapHorizIcon fontSize="small" color="action" />
      </ListItemIcon>
      <ListItemText
        primary={
          <Typography variant="body2">
            Moved — {movement.fromLocation?.name ?? 'No location'} →{' '}
            {movement.toLocation?.name ?? 'No location'}
          </Typography>
        }
        secondary={
          <Typography variant="caption" color="text.secondary">
            {formatRelativeTime(movement.createdAt)}
          </Typography>
        }
      />
    </ListItem>
  );
}

/**
 * `/locations/:id` — breadcrumb, child locations as tappable cards, the
 * location's direct items (reusing `ItemCard`), a printable QR sticker block,
 * an "Add item here" shortcut into intake with the location pre-selected,
 * and — for `container` locations (EVT-30) — a "Move to…" re-parent flow
 * plus the container's own move history.
 */
export function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);

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

  const isContainer = locationQuery.data?.kind === 'container';

  const movementsQuery = useQuery({
    queryKey: ['locations', id, 'movements'],
    queryFn: () => fetchContainerMovements(id as string, { page: 1, pageSize: 20 }),
    enabled: Boolean(id) && isContainer,
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
  const moveTargets = validMoveTargets(allLocationsQuery.data ?? [], location);

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
        <Stack direction="row" alignItems="center" spacing={1}>
          <KindIcon kind={location.kind} />
          <Typography variant="h5" component="h1">
            {location.name}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          {isContainer && (
            <Button
              variant="outlined"
              startIcon={<SwapHorizIcon />}
              onClick={() => setMoveDialogOpen(true)}
            >
              Move to…
            </Button>
          )}
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
      </Stack>

      {isContainer && (
        <MoveContainerDialog
          open={moveDialogOpen}
          onClose={() => setMoveDialogOpen(false)}
          container={location}
          destinations={moveTargets}
        />
      )}

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
                      <KindIcon kind={child.kind} fontSize="small" />
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

      {isContainer && (
        <>
          <Divider />
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Move history
            </Typography>
            {movementsQuery.isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            )}
            {movementsQuery.isError && <Alert severity="error">Failed to load history</Alert>}
            {movementsQuery.data && movementsQuery.data.data.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No moves recorded yet.
              </Typography>
            )}
            {movementsQuery.data && movementsQuery.data.data.length > 0 && (
              <List disablePadding aria-label="container move history">
                {movementsQuery.data.data.map((movement) => (
                  <ContainerMovementListItem key={movement.id} movement={movement} />
                ))}
              </List>
            )}
          </Box>
        </>
      )}

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
