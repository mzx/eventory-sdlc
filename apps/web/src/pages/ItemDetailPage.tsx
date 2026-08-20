import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ConstructionIcon from '@mui/icons-material/Construction';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TuneIcon from '@mui/icons-material/Tune';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  consumeItem,
  countItem,
  deleteItem,
  fetchItem,
  fetchItemMovements,
  isCountOverdue,
  markRunningLow,
  photoUrl,
  type ItemDetail,
  type PhotoRef,
  type StockMovementKind,
  type StockMovementRow,
} from '../api';
import { formatRelativeTime } from '../lib/relativeTime';
import { wsKey } from '../lib/queryKeys';
import { CountDialog } from '../components/CountDialog';
import { QrThumb } from '../components/QrThumb';
import { READ_ONLY_HINT, useActiveWorkspaceId, useIsViewer } from '../workspace/useActiveWorkspace';

/** How many additional rows "Load more" reveals each click (EVT-25 AC 6). */
const MOVEMENTS_PAGE_SIZE_STEP = 20;

/**
 * Backend cap on `pageSize` — mirrors `ListMovementsQueryDto`'s `@Max(100)`
 * (apps/api/src/stock-movements/list-movements-query.dto.ts). "Load more"
 * must never grow `movementsLimit` past this: the API 400s a `pageSize` over
 * 100, and the query error previously replaced the whole rendered History
 * section with an error alert instead of just declining to load more rows
 * (EVT-25 review round 2, finding 2).
 */
const MOVEMENTS_PAGE_SIZE_CAP = 100;

const MOVEMENT_KIND_LABEL: Record<StockMovementKind, string> = {
  add: 'Added',
  consume: 'Consumed',
  move: 'Moved',
  adjust: 'Adjusted',
  build: 'Built',
};

const MOVEMENT_KIND_ICON: Record<StockMovementKind, ReactNode> = {
  add: <AddCircleOutlineIcon fontSize="small" color="success" />,
  consume: <RemoveCircleOutlineIcon fontSize="small" color="error" />,
  move: <SwapHorizIcon fontSize="small" color="action" />,
  adjust: <TuneIcon fontSize="small" color="action" />,
  build: <ConstructionIcon fontSize="small" color="action" />,
};

/**
 * A `build` movement's `delta` is negative — EVT-28 backflush *consumes* BOM
 * stock on project completion, it doesn't produce it (see the
 * `StockMovementKind` schema doc comment) — so the plain "Built -2" reading
 * from `MOVEMENT_KIND_LABEL`/`MOVEMENT_KIND_ICON` is confusing (review round
 * 2, finding 4). Every other kind's delta sign always matches its label, so
 * this only branches for `build`.
 */
function movementLabel(movement: StockMovementRow): string {
  if (movement.kind === 'build' && movement.delta < 0) {
    return 'Consumed in build';
  }
  return MOVEMENT_KIND_LABEL[movement.kind];
}

function movementIcon(movement: StockMovementRow): ReactNode {
  if (movement.kind === 'build' && movement.delta < 0) {
    return <RemoveCircleOutlineIcon fontSize="small" color="error" />;
  }
  return MOVEMENT_KIND_ICON[movement.kind];
}

/** Signed delta string ("+5", "-3"). `null` for `move`, whose delta is not the interesting part. */
function formatMovementDelta(movement: StockMovementRow): string | null {
  if (movement.kind === 'move') return null;
  return movement.delta > 0 ? `+${movement.delta}` : `${movement.delta}`;
}

/** "Garage → Cabinet 3" for a move; the single destination name for other kinds that carry one; else `null`. */
function formatMovementLocations(movement: StockMovementRow): string | null {
  if (movement.kind === 'move') {
    return `${movement.fromLocation?.name ?? '—'} → ${movement.toLocation?.name ?? '—'}`;
  }
  return movement.toLocation?.name ?? null;
}

/** One row of the item's movement history (EVT-25 AC 6): kind icon, delta, locations, project link, relative time. */
function MovementListItem({ movement }: { movement: StockMovementRow }) {
  const delta = formatMovementDelta(movement);
  const locations = formatMovementLocations(movement);

  return (
    <ListItem disableGutters alignItems="flex-start">
      <ListItemIcon sx={{ minWidth: 36 }}>{movementIcon(movement)}</ListItemIcon>
      <ListItemText
        primary={
          <Typography variant="body2">
            {movementLabel(movement)}
            {delta ? ` ${delta}` : ''}
            {locations ? ` — ${locations}` : ''}
          </Typography>
        }
        secondary={
          <Stack direction="row" spacing={1} alignItems="center" component="span">
            <Typography variant="caption" color="text.secondary" component="span">
              {formatRelativeTime(movement.createdAt)}
            </Typography>
            {movement.project && (
              <Link
                component={RouterLink}
                to={`/projects/${movement.project.id}`}
                variant="caption"
              >
                {movement.project.name}
              </Link>
            )}
          </Stack>
        }
      />
    </ListItem>
  );
}

/** Orders `photos` with the primary photo first (if set), keeping the rest
 * in their existing (createdAt asc) order. */
function orderedGallery(item: ItemDetail): PhotoRef[] {
  if (!item.primaryPhotoId) return item.photos;
  const primary = item.photos.find((p) => p.id === item.primaryPhotoId);
  if (!primary) return item.photos;
  return [primary, ...item.photos.filter((p) => p.id !== item.primaryPhotoId)];
}

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const isViewer = useIsViewer();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Set by IntakePage's `navigate(..., { state: { justCreated: true } })`
  // after saving a new item — surfaces a "Print QR" shortcut so the user
  // doesn't have to hunt for the sticker after the signature intake flow.
  const [justCreatedToastOpen, setJustCreatedToastOpen] = useState(
    Boolean((location.state as { justCreated?: boolean } | null)?.justCreated),
  );

  const itemQuery = useQuery({
    queryKey: wsKey(workspaceId, 'items', id),
    queryFn: () => fetchItem(id as string),
    enabled: Boolean(id) && workspaceId != null,
  });

  // "Load more" grows pageSize on a fixed page 1 rather than tracking a page
  // number — avoids merging pages by hand while still only re-fetching the
  // window actually being displayed.
  const [movementsLimit, setMovementsLimit] = useState(MOVEMENTS_PAGE_SIZE_STEP);
  const movementsQuery = useQuery({
    queryKey: wsKey(workspaceId, 'items', id, 'movements', movementsLimit),
    queryFn: () => fetchItemMovements(id as string, { page: 1, pageSize: movementsLimit }),
    enabled: Boolean(id) && workspaceId != null,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteItem(id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'items') });
      navigate('/');
    },
    onError: (error: unknown) => {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete item');
    },
  });

  // "Running low" — one-tap manual shopping-list trigger (EVT-26 AC 3). This
  // is the same action offered on the scan-landing page — a scanned item QR
  // redirects here (see ScanPage), so this one button covers both spots the
  // task calls out rather than duplicating it on a page that immediately
  // navigates away.
  const [runningLowToastOpen, setRunningLowToastOpen] = useState(false);
  const runningLowMutation = useMutation({
    mutationFn: () => markRunningLow(id as string),
    onSuccess: () => {
      // The nav badge (AC 6) and the Shopping List page (AC 4) both read
      // this query key.
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'shopping-list') });
      setRunningLowToastOpen(true);
    },
  });

  // "Verify count" (EVT-27 AC 2/5) — the blind-entry `CountDialog` is shared
  // with the opportunistic "how many are actually left?" prompt below (both
  // just want a blind count recorded); `countDialogOpen` drives whichever
  // triggered it.
  const [countDialogOpen, setCountDialogOpen] = useState(false);
  const countMutation = useMutation({
    mutationFn: (quantity: number) => countItem(id as string, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'items') });
      // A count can clear an item's overdue verification, so the queue
      // VerificationPage reads must also be invalidated here (mirrors
      // VerificationPage's own countMutation.onSuccess).
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'verification-queue') });
    },
  });

  // "Use" — consumes stock (EVT-27 AC 4). A consume that leaves on-hand at
  // or below `max(minQuantity, 2)` offers the opportunistic count prompt;
  // skipping it is one tap and leaves no state behind.
  const [useDialogOpen, setUseDialogOpen] = useState(false);
  const [useQuantity, setUseQuantity] = useState('1');
  const [useError, setUseError] = useState<string | null>(null);
  const [offerVerificationOpen, setOfferVerificationOpen] = useState(false);
  const consumeMutation = useMutation({
    mutationFn: (quantity: number) => consumeItem(id as string, quantity),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'items') });
      setUseDialogOpen(false);
      setUseError(null);
      if (result.offerVerification) {
        setOfferVerificationOpen(true);
      }
    },
    onError: (error: unknown) => {
      setUseError(error instanceof Error ? error.message : 'Failed to record consumption');
    },
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
  const gallery = orderedGallery(item);
  const propertyEntries = Object.entries(item.properties ?? {});
  // "Verify count" affordance (EVT-27 AC 5) — this page doubles as the
  // scan-landing page (a scanned item QR redirects straight here, see
  // ScanPage), so this covers both spots the AC calls out without
  // duplicating the button on a page that immediately navigates away.
  const overdue = item.countIntervalDays != null && isCountOverdue(item);
  // `path` is a materialized path whose last segment is the current location's
  // own slug (e.g. 'garage.cabinet-3' for 'Cabinet 3'), so drop it — the leaf
  // is rendered separately below via `item.location.name`.
  const locationSegments = item.location ? item.location.path.split('.').slice(0, -1) : [];

  return (
    <Stack spacing={3}>
      {/* Header: title grouped with its primary (Edit) and subordinate
          (Delete) actions, so Edit reads as anchored to the item it edits
          rather than floating alone at the page top (gh-issue-34). Wraps to
          a second line on phone widths so both actions stay reachable. */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        flexWrap="wrap"
        gap={2}
      >
        <Box>
          <Typography variant="h5" component="h1" gutterBottom>
            {item.name}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Qty: {item.quantity}
            {item.unit ? ` ${item.unit}` : ''}
            {item.minQuantity != null && ` (min ${item.minQuantity})`}
          </Typography>
          {item.description && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {item.description}
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
            <Tooltip title={isViewer ? READ_ONLY_HINT : ''}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  startIcon={<WarningAmberOutlinedIcon fontSize="small" />}
                  onClick={() => runningLowMutation.mutate()}
                  disabled={isViewer || runningLowMutation.isPending}
                >
                  Running low
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={isViewer ? READ_ONLY_HINT : ''}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RemoveCircleOutlineIcon fontSize="small" />}
                  onClick={() => {
                    setUseQuantity('1');
                    setUseError(null);
                    setUseDialogOpen(true);
                  }}
                  disabled={isViewer || item.quantity <= 0}
                >
                  Use
                </Button>
              </span>
            </Tooltip>
            {overdue && (
              <Tooltip title={isViewer ? READ_ONLY_HINT : ''}>
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    color="info"
                    startIcon={<FactCheckOutlinedIcon fontSize="small" />}
                    onClick={() => setCountDialogOpen(true)}
                    disabled={isViewer}
                  >
                    Verify count
                  </Button>
                </span>
              </Tooltip>
            )}
            {isViewer && (
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                Read-only access
              </Typography>
            )}
          </Stack>
        </Box>
        {!isViewer && (
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<EditOutlinedIcon />}
              onClick={() => navigate(`/items/${item.id}/edit`)}
            >
              Edit
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => {
                setDeleteError(null);
                setConfirmOpen(true);
              }}
            >
              Delete
            </Button>
          </Stack>
        )}
      </Stack>

      {gallery.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
          {gallery.map((photo, i) => (
            <Box
              key={photo.id}
              component="img"
              src={photoUrl(photo.filename)}
              alt={
                i === 0 && item.primaryPhotoId === photo.id
                  ? `${item.name} (primary photo)`
                  : item.name
              }
              sx={{
                width: 200,
                height: 150,
                objectFit: 'cover',
                borderRadius: 1,
                border: photo.id === item.primaryPhotoId ? 2 : 1,
                borderColor: photo.id === item.primaryPhotoId ? 'primary.main' : 'divider',
                flexShrink: 0,
              }}
            />
          ))}
        </Stack>
      ) : (
        <Box
          sx={{
            height: 150,
            bgcolor: 'background.default',
            // Empty drafting area: diagonal hatch until a photo is drawn in.
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(159, 198, 232, 0.07) 0 1px, transparent 1px 9px)',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Inventory2OutlinedIcon sx={{ fontSize: 48, color: 'grey.400' }} />
        </Box>
      )}

      {item.tags.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {item.tags.map(({ tag }) => (
            <Chip key={tag.id} label={tag.name} size="small" />
          ))}
        </Stack>
      )}

      <Stack spacing={1}>
        {item.location && (
          <Breadcrumbs aria-label="location breadcrumb">
            {locationSegments.map((segment, i) => (
              <Typography key={i} variant="body2" color="text.secondary">
                {segment}
              </Typography>
            ))}
            {/* Locations pages (EVT-12) don't exist yet, so the current
                location is plain text rather than a link to a blank page. */}
            <Typography variant="body2" color="text.secondary">
              {item.location.name}
            </Typography>
          </Breadcrumbs>
        )}
        {item.category && (
          <Typography variant="body2" color="text.secondary">
            Category: {item.category.path.replace(/\./g, ' › ')}
          </Typography>
        )}
      </Stack>

      {propertyEntries.length > 0 && (
        <Box>
          <Typography variant="subtitle1" gutterBottom>
            Properties
          </Typography>
          <Table size="small" aria-label="item properties">
            <TableBody>
              {propertyEntries.map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell component="th" scope="row" sx={{ fontWeight: 'medium' }}>
                    {key}
                  </TableCell>
                  <TableCell>{String(value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Divider />

      <Box>
        <Typography variant="subtitle1" gutterBottom>
          History
        </Typography>
        {movementsQuery.isLoading && (
          <Box sx={{ display: 'flex', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {movementsQuery.isError && <Alert severity="error">Failed to load history</Alert>}
        {movementsQuery.data && movementsQuery.data.data.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No movements recorded yet.
          </Typography>
        )}
        {movementsQuery.data && movementsQuery.data.data.length > 0 && (
          <List disablePadding aria-label="item movement history">
            {movementsQuery.data.data.map((movement) => (
              <MovementListItem key={movement.id} movement={movement} />
            ))}
          </List>
        )}
        {movementsQuery.data &&
          movementsQuery.data.total > movementsQuery.data.data.length &&
          movementsLimit < MOVEMENTS_PAGE_SIZE_CAP && (
            <Button
              size="small"
              onClick={() =>
                setMovementsLimit((n) =>
                  Math.min(n + MOVEMENTS_PAGE_SIZE_STEP, MOVEMENTS_PAGE_SIZE_CAP),
                )
              }
            >
              Load more
            </Button>
          )}
        {movementsQuery.data &&
          movementsQuery.data.total > movementsQuery.data.data.length &&
          movementsLimit >= MOVEMENTS_PAGE_SIZE_CAP && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Showing the first {MOVEMENTS_PAGE_SIZE_CAP} movements.
            </Typography>
          )}
      </Box>

      <Divider />

      <QrThumb token={item.qrCode} printHref={`/items/${item.id}/print`} size={256} />

      <Dialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setDeleteError(null);
        }}
      >
        <DialogTitle>Delete {item.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently removes the item and its photo associations. This cannot be undone.
          </DialogContentText>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setConfirmOpen(false);
              setDeleteError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={justCreatedToastOpen}
        autoHideDuration={6000}
        onClose={() => setJustCreatedToastOpen(false)}
        message="Item saved"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setJustCreatedToastOpen(false);
              navigate(`/items/${item.id}/print`);
            }}
          >
            Print QR
          </Button>
        }
      />

      <Snackbar
        open={runningLowToastOpen}
        autoHideDuration={4000}
        onClose={() => setRunningLowToastOpen(false)}
        message="Added to shopping list"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setRunningLowToastOpen(false);
              navigate('/shopping-list');
            }}
          >
            View
          </Button>
        }
      />

      <Dialog
        open={useDialogOpen}
        onClose={() => {
          setUseDialogOpen(false);
          setUseError(null);
        }}
      >
        <DialogTitle>Use {item.name}</DialogTitle>
        <DialogContent>
          <DialogContentText>How many are being used?</DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="Quantity"
            type="number"
            fullWidth
            value={useQuantity}
            onChange={(e) => setUseQuantity(e.target.value)}
            inputProps={{ min: 1, max: item.quantity, inputMode: 'numeric', pattern: '[0-9]*' }}
          />
          {useError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {useError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setUseDialogOpen(false);
              setUseError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              consumeMutation.isPending || useQuantity.trim() === '' || Number(useQuantity) <= 0
            }
            onClick={() => consumeMutation.mutate(Number(useQuantity))}
          >
            Use
          </Button>
        </DialogActions>
      </Dialog>

      {/* Opportunistic verification prompt (EVT-27 AC 4) — rides the "Use"
          confirmation; skipping is one tap and leaves no state behind. */}
      <Snackbar
        open={offerVerificationOpen}
        onClose={() => setOfferVerificationOpen(false)}
        message="How many are actually left?"
        action={
          <Stack direction="row" spacing={1}>
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setOfferVerificationOpen(false);
                setCountDialogOpen(true);
              }}
            >
              Count
            </Button>
            <Button color="inherit" size="small" onClick={() => setOfferVerificationOpen(false)}>
              Skip
            </Button>
          </Stack>
        }
      />

      <CountDialog
        open={countDialogOpen}
        itemName={item.name}
        onCount={(quantity) => countMutation.mutateAsync(quantity)}
        onClose={() => setCountDialogOpen(false)}
      />
    </Stack>
  );
}
