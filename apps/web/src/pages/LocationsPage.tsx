import AddIcon from '@mui/icons-material/Add';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createLocation,
  deleteLocation,
  fetchLocations,
  renameLocation,
  type LocationKind,
  type LocationListItem,
} from '../api';
import { LocationTree } from '../components/LocationTree';
import { buildLocationTree } from '../lib/locationTree';
import { wsKey } from '../lib/queryKeys';
import { READ_ONLY_HINT, useActiveWorkspaceId, useIsViewer } from '../workspace/useActiveWorkspace';

/**
 * `/locations` — collapsible tree of the whole location hierarchy with item
 * counts, inline "add child" at every node (and at root), rename, and delete
 * (disabled while a node still has children). All mutations invalidate the
 * `['locations']` query so the tree re-renders with the composed path/counts
 * the API returns.
 */
export function LocationsPage() {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const isViewer = useIsViewer();
  const [addingRoot, setAddingRoot] = useState(false);
  const [rootName, setRootName] = useState('');
  const [rootKind, setRootKind] = useState<LocationKind>('area');
  const [mutationError, setMutationError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: wsKey(workspaceId, 'locations'),
    queryFn: fetchLocations,
    enabled: workspaceId != null,
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'locations') });
  }

  const createMutation = useMutation({
    mutationFn: (input: { name: string; parentId?: string; kind?: LocationKind }) =>
      createLocation(input),
    onSuccess: () => {
      setMutationError(null);
      return invalidate();
    },
    onError: (err) =>
      setMutationError(err instanceof Error ? err.message : 'Failed to create location'),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameLocation(id, name),
    onSuccess: () => {
      setMutationError(null);
      return invalidate();
    },
    onError: (err) =>
      setMutationError(err instanceof Error ? err.message : 'Failed to rename location'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onSuccess: () => {
      setMutationError(null);
      return invalidate();
    },
    onError: (err) =>
      setMutationError(err instanceof Error ? err.message : 'Failed to delete location'),
  });

  function handleAddChild(parentId: string | null, name: string, kind: LocationKind = 'area') {
    createMutation.mutate({ name, parentId: parentId ?? undefined, kind });
  }

  function submitRootAdd() {
    const trimmed = rootName.trim();
    if (!trimmed) return;
    handleAddChild(null, trimmed, rootKind);
    setRootName('');
    setRootKind('area');
    setAddingRoot(false);
  }

  const locations: LocationListItem[] = locationsQuery.data ?? [];
  const tree = buildLocationTree(locations);

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h5" component="h1">
          Locations
        </Typography>
        {isViewer ? (
          <Typography variant="caption" color="text.secondary">
            {READ_ONLY_HINT}
          </Typography>
        ) : (
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setAddingRoot((v) => !v)}
            variant="outlined"
          >
            Add root location
          </Button>
        )}
      </Stack>

      {addingRoot && !isViewer && (
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            autoFocus
            placeholder="New root location name"
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRootAdd();
              if (e.key === 'Escape') setAddingRoot(false);
            }}
            inputProps={{ 'aria-label': 'New root location name' }}
            fullWidth
          />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={rootKind}
            onChange={(_e, value: LocationKind | null) => value && setRootKind(value)}
            aria-label="New root location kind"
          >
            <ToggleButton value="area" aria-label="Area">
              <Tooltip title="Area (fixed shelf/room)">
                <FolderOutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="container" aria-label="Container">
              <Tooltip title="Container (movable box)">
                <Inventory2OutlinedIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <Button onClick={submitRootAdd} variant="contained">
            Add
          </Button>
        </Stack>
      )}

      {mutationError && <Alert severity="error">{mutationError}</Alert>}

      {locationsQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {locationsQuery.isError && (
        <Alert severity="error">
          {locationsQuery.error instanceof Error
            ? locationsQuery.error.message
            : 'Failed to load locations'}
        </Alert>
      )}

      {locationsQuery.isSuccess && locations.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No locations yet. Add a root location to start building your tree.
        </Typography>
      )}

      {tree.length > 0 && (
        <LocationTree
          nodes={tree}
          onAddChild={handleAddChild}
          onRename={(id, name) => renameMutation.mutate({ id, name })}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      )}
    </Stack>
  );
}
