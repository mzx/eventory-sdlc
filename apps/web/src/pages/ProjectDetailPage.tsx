import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  addBomLine,
  deleteBomLine,
  deleteProject,
  fetchItems,
  fetchProject,
  updateBomLine,
  updateProject,
  type BomLine,
  type ItemListRow,
  type ProjectStatus,
} from '../api';

const SEARCH_DEBOUNCE_MS = 300;
const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
};
const STATUS_OPTIONS: ProjectStatus[] = ['planned', 'in_progress', 'completed', 'archived'];

/** Debounces a fast-changing value; returns the value once it has settled. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Parses the raw quantity input and clamps it to the API's `@Min(1)`
 * constraint, so negative/zero/NaN values never reach the network (the API
 * would reject them with a 400 and the mutation would silently fail with no
 * feedback beyond the generic error alert).
 */
function clampQuantity(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

/** One row in the BOM table. Linked rows navigate to the item detail page. */
function BomLineRow({ projectId, line }: { projectId: string; line: BomLine }) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => deleteBomLine(projectId, line.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId] }),
  });
  const unlinkMutation = useMutation({
    mutationFn: () => updateBomLine(projectId, line.id, { itemId: null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId] }),
  });

  return (
    <TableRow>
      <TableCell>
        {line.item ? <RouterLink to={`/items/${line.item.id}`}>{line.name}</RouterLink> : line.name}
      </TableCell>
      <TableCell align="right">{line.quantity}</TableCell>
      <TableCell>{line.unit ?? ''}</TableCell>
      <TableCell>{line.notes ?? ''}</TableCell>
      <TableCell align="right">
        {line.item && (
          <Tooltip title="Unlink from inventory item">
            <IconButton
              size="small"
              aria-label={`Unlink ${line.name}`}
              onClick={() => unlinkMutation.mutate()}
              disabled={unlinkMutation.isPending}
            >
              <LinkOffIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <IconButton
          size="small"
          aria-label={`Delete ${line.name}`}
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  );
}

/** Add-line row: item autocomplete (against GET /api/items?search=) or free text. */
function AddBomLineRow({ projectId }: { projectId: string }) {
  const [inputValue, setInputValue] = useState('');
  const [selectedItem, setSelectedItem] = useState<ItemListRow | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const debouncedSearch = useDebouncedValue(inputValue, SEARCH_DEBOUNCE_MS);

  const itemsQuery = useQuery({
    queryKey: ['items', 'bom-autocomplete', debouncedSearch],
    queryFn: () => fetchItems({ search: debouncedSearch }),
    enabled: debouncedSearch.trim().length > 0 && selectedItem === null,
  });

  const queryClient = useQueryClient();
  const addMutation = useMutation({
    mutationFn: () =>
      addBomLine(projectId, {
        itemId: selectedItem?.id,
        name: selectedItem ? undefined : inputValue.trim(),
        quantity: clampQuantity(quantity),
        unit: unit.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      setInputValue('');
      setSelectedItem(null);
      setQuantity('1');
      setUnit('');
    },
  });

  const canAdd = (selectedItem !== null || inputValue.trim().length > 0) && !addMutation.isPending;

  return (
    <>
      <TableRow>
        <TableCell colSpan={2}>
          <Autocomplete<ItemListRow, false, false, true>
            freeSolo
            options={itemsQuery.data ?? []}
            loading={itemsQuery.isFetching}
            getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
            isOptionEqualToValue={(option, value) =>
              typeof option !== 'string' && typeof value !== 'string' && option.id === value.id
            }
            inputValue={inputValue}
            onInputChange={(_event, value) => {
              setInputValue(value);
              setSelectedItem(null);
            }}
            onChange={(_event, value) => {
              if (value && typeof value !== 'string') {
                setSelectedItem(value);
                setInputValue(value.name);
              } else {
                setSelectedItem(null);
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label="Item or free text"
                placeholder="Search inventory or type a new line…"
              />
            )}
          />
        </TableCell>
        <TableCell>
          <TextField
            size="small"
            type="number"
            label="Qty"
            value={quantity}
            // Only clamp the actual quantity sent to the API (see
            // clampQuantity in mutationFn) — the raw string is kept here so
            // the field remains freely editable (e.g. clearing to retype).
            onChange={(e) => setQuantity(e.target.value)}
            sx={{ width: 90 }}
            inputProps={{ min: 1, 'aria-label': 'Quantity' }}
          />
        </TableCell>
        <TableCell>
          <TextField
            size="small"
            label="Unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            sx={{ width: 90 }}
          />
        </TableCell>
        <TableCell align="right">
          <Button
            size="small"
            variant="contained"
            onClick={() => addMutation.mutate()}
            disabled={!canAdd}
          >
            Add
          </Button>
        </TableCell>
      </TableRow>
      {addMutation.isError && (
        <TableRow>
          <TableCell colSpan={5} sx={{ border: 0, pt: 0 }}>
            <Alert severity="error" sx={{ mt: 1 }}>
              {addMutation.error instanceof Error
                ? addMutation.error.message
                : 'Failed to add BOM line'}
            </Alert>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** `/projects/:id` — editable header + status, BOM table with add-line row. */
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ['projects', id],
    queryFn: () => fetchProject(id as string),
    enabled: Boolean(id),
  });

  const statusMutation = useMutation({
    mutationFn: (status: ProjectStatus) => updateProject(id as string, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', id] }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: () => deleteProject(id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
    },
  });

  if (projectQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (projectQuery.isError || !projectQuery.data) {
    return (
      <Alert severity="error">
        {projectQuery.error instanceof Error
          ? projectQuery.error.message
          : 'Failed to load project'}
      </Alert>
    );
  }

  const project = projectQuery.data;

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        flexWrap="wrap"
        gap={2}
      >
        <Box>
          <Typography variant="h5" component="h1">
            {project.name}
          </Typography>
          {project.description && (
            <Typography variant="body2" color="text.secondary">
              {project.description}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            select
            size="small"
            label="Status"
            value={project.status}
            onChange={(e) => statusMutation.mutate(e.target.value as ProjectStatus)}
            sx={{ minWidth: 160 }}
          >
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={() => deleteProjectMutation.mutate()}
            disabled={deleteProjectMutation.isPending}
          >
            Delete project
          </Button>
        </Stack>
      </Stack>

      {deleteProjectMutation.isError && (
        <Alert severity="error">
          {deleteProjectMutation.error instanceof Error
            ? deleteProjectMutation.error.message
            : 'Failed to delete project'}
        </Alert>
      )}

      <Box>
        <Typography variant="h6" gutterBottom>
          Bill of materials
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {project.bomLines.map((line) => (
              <BomLineRow key={line.id} projectId={project.id} line={line} />
            ))}
            <AddBomLineRow projectId={project.id} />
          </TableBody>
        </Table>
        {project.bomLines.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No BOM lines yet — add one above.
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
