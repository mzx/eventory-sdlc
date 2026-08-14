import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
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
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  addBomLine,
  confirmBackflush,
  deleteBomLine,
  deleteProject,
  fetchBackflushPreview,
  fetchItems,
  fetchProject,
  fetchProjectAvailability,
  markRunningLow,
  updateBomLine,
  updateProject,
  type AvailabilityLine,
  type AvailabilityStatus,
  type BackflushPreview,
  type BackflushPreviewLine,
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

const AVAILABILITY_CHIP: Record<
  AvailabilityStatus,
  { label: string; color: 'success' | 'warning' | 'default' }
> = {
  ok: { label: 'OK', color: 'success' },
  short: { label: 'Short', color: 'warning' },
  untracked: { label: 'Untracked', color: 'default' },
};

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

/**
 * Add-line form (EVT-36 AC 2): item autocomplete (against GET
 * /api/items?search=) or free text. Previously an in-table row — an
 * Autocomplete + two fixed-90px TextFields packed into one TableRow broke
 * down at ~390px (2026-08-14 mobile audit finding #2). Rendered as a
 * stacked form below the BOM table instead so it stays usable at phone
 * widths regardless of breakpoint.
 */
function AddBomLineForm({ projectId }: { projectId: string }) {
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
    <Stack spacing={1.5} sx={{ mt: 2 }}>
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
      <Stack direction="row" spacing={1.5} flexWrap="wrap" alignItems="flex-start" gap={1.5}>
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
        <TextField
          size="small"
          label="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          sx={{ width: 90 }}
        />
        <Button
          size="small"
          variant="contained"
          onClick={() => addMutation.mutate()}
          disabled={!canAdd}
        >
          Add
        </Button>
      </Stack>
      {addMutation.isError && (
        <Alert severity="error">
          {addMutation.error instanceof Error
            ? addMutation.error.message
            : 'Failed to add BOM line'}
        </Alert>
      )}
    </Stack>
  );
}

/**
 * One availability line as a stacked card (EVT-36 AC 1) — used below the
 * `sm` breakpoint instead of the table, where a 6-column row (name,
 * required, on-hand, location, status, action) compressed to unreadable
 * slivers at ~390px (2026-08-14 mobile audit finding #2).
 */
function AvailabilityLineCard({
  line,
  onAddToShoppingList,
  isAdding,
}: {
  line: AvailabilityLine;
  onAddToShoppingList: (itemId: string) => void;
  isAdding: boolean;
}) {
  return (
    <Box
      data-testid="availability-line-card"
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {line.name}
        </Typography>
        <Chip
          size="small"
          label={AVAILABILITY_CHIP[line.status].label}
          color={AVAILABILITY_CHIP[line.status].color}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {line.quantity} {line.unit ?? ''} required · {line.onHand ?? '—'} on hand
        {line.location?.path ? ` · ${line.location.path}` : ''}
      </Typography>
      {line.status === 'short' && line.itemId && (
        <Button
          size="small"
          sx={{ mt: 1 }}
          onClick={() => onAddToShoppingList(line.itemId as string)}
          disabled={isAdding}
        >
          Add to shopping list
        </Button>
      )}
    </Box>
  );
}

/**
 * "Can I build this?" panel (EVT-29 AC 1, AC 2) — the clear-to-build check.
 * Shows an all-clear/short/untracked summary plus a per-line breakdown
 * (linked item, required qty, on-hand, location, status), and a one-tap "Add
 * to shopping list" action on shortage lines (AC 4, reuses EVT-26's
 * idempotent `POST /api/shopping-list`). Links to the kitting pick list (AC
 * 3). Read-only, point-in-time — see `availability.asOf` (EVT-29 risk).
 *
 * Below the `sm` breakpoint the per-line breakdown renders as stacked cards
 * instead of the 6-column table, which compressed to unreadable slivers at
 * ~390px and forced page-level horizontal scroll (EVT-36, 2026-08-14 mobile
 * audit finding #2). At `sm` and up the table is kept but wrapped in a
 * horizontally-scrollable container (matches AdminUsersPage's `overflowX:
 * 'auto'` pattern) as a fallback for any content still wider than the
 * viewport.
 */
function AvailabilityPanel({ projectId }: { projectId: string }) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const availabilityQuery = useQuery({
    queryKey: ['projects', projectId, 'availability'],
    queryFn: () => fetchProjectAvailability(projectId),
  });

  const addToShoppingListMutation = useMutation({
    mutationFn: (itemId: string) => markRunningLow(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shopping-list'] }),
  });

  if (availabilityQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (availabilityQuery.isError || !availabilityQuery.data) {
    return (
      <Alert severity="error">
        {availabilityQuery.error instanceof Error
          ? availabilityQuery.error.message
          : 'Failed to load availability'}
      </Alert>
    );
  }

  const availability = availabilityQuery.data;
  const { counts, lines } = availability;

  if (lines.length === 0) {
    return null;
  }

  const summaryParts: string[] = [];
  if (counts.short > 0) summaryParts.push(`${counts.short} short`);
  if (counts.untracked > 0) summaryParts.push(`${counts.untracked} untracked`);

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={1}
      >
        <Typography variant="h6">Can I build this?</Typography>
        <Button component={RouterLink} to={`/projects/${projectId}/pick-list`} size="small">
          Pick list
        </Button>
      </Stack>

      <Alert severity={availability.clearToBuild ? 'success' : 'warning'} sx={{ mt: 1 }}>
        {availability.clearToBuild
          ? 'All clear — every tracked part is on hand.'
          : summaryParts.join(', ')}
      </Alert>

      {isXs ? (
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {lines.map((line) => (
            <AvailabilityLineCard
              key={line.lineId}
              line={line}
              onAddToShoppingList={(itemId) => addToShoppingListMutation.mutate(itemId)}
              isAdding={addToShoppingListMutation.isPending}
            />
          ))}
        </Stack>
      ) : (
        <Box sx={{ overflowX: 'auto', mt: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Line</TableCell>
                <TableCell align="right">Required</TableCell>
                <TableCell align="right">On hand</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.lineId}>
                  <TableCell>{line.name}</TableCell>
                  <TableCell align="right">
                    {line.quantity} {line.unit ?? ''}
                  </TableCell>
                  <TableCell align="right">{line.onHand ?? '—'}</TableCell>
                  <TableCell>{line.location?.path ?? '—'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={AVAILABILITY_CHIP[line.status].label}
                      color={AVAILABILITY_CHIP[line.status].color}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {line.status === 'short' && line.itemId && (
                      <Button
                        size="small"
                        onClick={() => addToShoppingListMutation.mutate(line.itemId as string)}
                        disabled={addToShoppingListMutation.isPending}
                      >
                        Add to shopping list
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {addToShoppingListMutation.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {addToShoppingListMutation.error instanceof Error
            ? addToShoppingListMutation.error.message
            : 'Failed to add to shopping list'}
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        As of {new Date(availability.asOf).toLocaleString()}
      </Typography>
    </Box>
  );
}

/**
 * Parses a backflush consume-quantity input and clamps it to `[0, max]`
 * (the line's plan quantity — AC 1/2's "0..line qty" per-line override),
 * mirroring `clampQuantity`'s NaN/negative handling above.
 */
function clampConsumeQuantity(raw: string, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(0, Math.trunc(parsed)), max);
}

/**
 * One backflush line as a stacked, tappable card (EVT-36 AC 3) — used below
 * the `sm` breakpoint instead of the 4-column table, where the 90px consume
 * input packed alongside plan/on-hand columns invited mis-taps at ~390px on
 * the exact screen that writes inventory (2026-08-14 mobile audit finding
 * #3).
 */
function BackflushLineCard({
  line,
  quantity,
  onChange,
}: {
  line: BackflushPreviewLine;
  quantity: number;
  onChange: (value: string) => void;
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {line.name}
        </Typography>
        {line.shortage && <Chip label="Shortage" color="warning" size="small" />}
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5, mb: 1 }}
      >
        Plan {line.quantity} {line.unit ?? ''} · On hand {line.onHand}
      </Typography>
      <TextField
        fullWidth
        size="small"
        type="number"
        label="Consume"
        value={quantity}
        onChange={(e) => onChange(e.target.value)}
        inputProps={{
          min: 0,
          max: line.quantity,
          'aria-label': `Consume quantity for ${line.name}`,
        }}
      />
    </Box>
  );
}

/**
 * Backflush confirmation screen (EVT-28 AC 1) — shown when marking a
 * project `completed` and it has at least one item-linked BOM line.
 * Per-line consume quantity is editable (0..line quantity, AC 2), shortages
 * (on-hand < plan) are highlighted, and free-text lines are listed
 * separately as "not tracked — skipped" (AC 3). Confirming writes one
 * `build` movement per consumed line and marks the project completed,
 * atomically; closing the dialog (Cancel / backdrop) writes nothing.
 *
 * Renders `fullScreen` below the `sm` breakpoint (EVT-36 AC 3) — this is the
 * screen where inventory is actually written, so mis-taps in a cramped
 * maxWidth='sm' dialog were a real hazard at phone widths (2026-08-14
 * mobile audit finding #3). Below `sm` each line renders as a stacked
 * `BackflushLineCard` instead of a table row; clamping, skip, and confirm
 * behavior are unchanged.
 */
function BackflushDialog({
  projectId,
  preview,
  onClose,
}: {
  projectId: string;
  preview: BackflushPreview;
  onClose: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const linkedLines = preview.lines.filter((line) => !line.skipped);
  const skippedLines = preview.lines.filter((line) => line.skipped);

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(linkedLines.map((line) => [line.lineId, line.suggestedConsumeQuantity])),
  );
  // Idempotency guard (AC 6): required before Confirm is enabled when this
  // project already has recorded build movements.
  const [confirmAgain, setConfirmAgain] = useState(false);

  const confirmMutation = useMutation({
    mutationFn: () =>
      confirmBackflush(projectId, {
        lines: Object.entries(quantities).map(([lineId, consumeQuantity]) => ({
          lineId,
          consumeQuantity,
        })),
        ...(preview.alreadyBackflushed && { confirmAgain }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      onClose();
    },
  });

  const canConfirm = !confirmMutation.isPending && (!preview.alreadyBackflushed || confirmAgain);

  function handleQuantityChange(lineId: string, max: number, raw: string) {
    setQuantities((prev) => ({ ...prev, [lineId]: clampConsumeQuantity(raw, max) }));
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Complete project — confirm stock consumption</DialogTitle>
      <DialogContent>
        {preview.alreadyBackflushed && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This project was already completed and its BOM already consumed once. Confirming again
            records additional consumption (EVT-28 idempotency guard).
          </Alert>
        )}
        {fullScreen ? (
          <Stack spacing={1.5}>
            {linkedLines.map((line) => (
              <BackflushLineCard
                key={line.lineId}
                line={line}
                quantity={quantities[line.lineId] ?? 0}
                onChange={(raw) => handleQuantityChange(line.lineId, line.quantity, raw)}
              />
            ))}
          </Stack>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Line</TableCell>
                <TableCell align="right">Plan</TableCell>
                <TableCell align="right">On hand</TableCell>
                <TableCell align="right">Consume</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {linkedLines.map((line) => (
                <TableRow key={line.lineId}>
                  <TableCell>
                    {line.name}
                    {line.shortage && (
                      <Chip label="Shortage" color="warning" size="small" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {line.quantity} {line.unit ?? ''}
                  </TableCell>
                  <TableCell align="right">{line.onHand}</TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={quantities[line.lineId] ?? 0}
                      onChange={(e) =>
                        handleQuantityChange(line.lineId, line.quantity, e.target.value)
                      }
                      inputProps={{
                        min: 0,
                        max: line.quantity,
                        'aria-label': `Consume quantity for ${line.name}`,
                      }}
                      sx={{ width: 90 }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {skippedLines.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Not tracked — skipped:
            </Typography>
            {skippedLines.map((line) => (
              <Typography key={line.lineId} variant="body2" color="text.secondary">
                {line.name}
              </Typography>
            ))}
          </Box>
        )}
        {preview.alreadyBackflushed && (
          <FormControlLabel
            sx={{ mt: 2, display: 'block' }}
            control={
              <Checkbox
                checked={confirmAgain}
                onChange={(e) => setConfirmAgain(e.target.checked)}
              />
            }
            label="Consume again"
          />
        )}
        {confirmMutation.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {confirmMutation.error instanceof Error
              ? confirmMutation.error.message
              : 'Failed to confirm backflush'}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={confirmMutation.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => confirmMutation.mutate()} disabled={!canConfirm}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Project detail's "Consumed" section (EVT-28 AC 5) — the backflush history, newest first. */
function ConsumedSection({
  consumed,
}: {
  consumed: {
    id: string;
    delta: number;
    createdAt: string;
    item: { id: string; name: string } | null;
  }[];
}) {
  if (consumed.length === 0) {
    return null;
  }
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Consumed
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Item</TableCell>
            <TableCell align="right">Quantity</TableCell>
            <TableCell>When</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {consumed.map((movement) => (
            <TableRow key={movement.id}>
              <TableCell>
                {movement.item ? (
                  <RouterLink to={`/items/${movement.item.id}`}>{movement.item.name}</RouterLink>
                ) : (
                  'Deleted item'
                )}
              </TableCell>
              <TableCell align="right">{-movement.delta}</TableCell>
              <TableCell>{new Date(movement.createdAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
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

  // Marking a project `completed` triggers the backflush confirmation
  // screen (AC 1) instead of writing the status directly — see
  // `handleStatusChange` below. A project with no item-linked BOM lines has
  // nothing to confirm, so it completes immediately via `statusMutation`.
  const [backflushPreview, setBackflushPreview] = useState<BackflushPreview | null>(null);
  const previewMutation = useMutation({
    mutationFn: () => fetchBackflushPreview(id as string),
    onSuccess: (preview) => {
      const hasLinkedLines = preview.lines.some((line: BackflushPreviewLine) => !line.skipped);
      if (hasLinkedLines) {
        setBackflushPreview(preview);
      } else {
        statusMutation.mutate('completed');
      }
    },
  });

  function handleStatusChange(next: ProjectStatus) {
    if (next === 'completed') {
      previewMutation.mutate();
    } else {
      statusMutation.mutate(next);
    }
  }

  // Delete requires an explicit confirmation dialog (EVT-36 AC 4) — unlike
  // item deletion (confirm Dialog, see ItemDetailPage) and location deletion
  // (window.confirm), "Delete project" previously mutated on a single tap
  // right next to the Status select, a fat-finger hazard (2026-08-14 mobile
  // audit finding #4). Mirrors ItemDetailPage's confirm-Dialog pattern.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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
            onChange={(e) => handleStatusChange(e.target.value as ProjectStatus)}
            disabled={previewMutation.isPending}
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
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteProjectMutation.isPending}
          >
            Delete project
          </Button>
        </Stack>
      </Stack>

      {previewMutation.isError && (
        <Alert severity="error">
          {previewMutation.error instanceof Error
            ? previewMutation.error.message
            : 'Failed to load the backflush confirmation screen'}
        </Alert>
      )}

      {/* Re-opening a completed project does NOT auto-reverse its
          consumption (AC 6 / EVT-28 non-goal) — this notice explains that
          consumption stands and can only be adjusted manually. */}
      {project.status !== 'completed' && project.consumed.length > 0 && (
        <Alert severity="info">
          This project was previously completed and its BOM stock consumption was recorded.
          Re-opening it does not reverse that consumption — adjust item quantities manually if
          needed.
        </Alert>
      )}

      <AvailabilityPanel projectId={project.id} />

      <Box>
        <Typography variant="h6" gutterBottom>
          Bill of materials
        </Typography>
        {project.bomLines.length > 0 && (
          // Scroll containment (EVT-36 AC 1) — matches AdminUsersPage's
          // `overflowX: 'auto'` pattern so a long name/notes column scrolls
          // within the table instead of forcing page-level horizontal
          // scroll at ~390px (2026-08-14 mobile audit finding #2).
          <Box sx={{ overflowX: 'auto' }}>
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
              </TableBody>
            </Table>
          </Box>
        )}
        {project.bomLines.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No BOM lines yet — add one below.
          </Typography>
        )}
        <AddBomLineForm projectId={project.id} />
      </Box>

      <ConsumedSection consumed={project.consumed} />

      {backflushPreview && (
        <BackflushDialog
          projectId={project.id}
          preview={backflushPreview}
          onClose={() => setBackflushPreview(null)}
        />
      )}

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Delete {project.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently removes the project and its BOM lines. This cannot be undone.
          </DialogContentText>
          {deleteProjectMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteProjectMutation.error instanceof Error
                ? deleteProjectMutation.error.message
                : 'Failed to delete project'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => deleteProjectMutation.mutate()}
            disabled={deleteProjectMutation.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
