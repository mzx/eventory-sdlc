import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
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
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { deleteItem, fetchItem, photoUrl, type ItemDetail, type PhotoRef } from '../api';
import { QrThumb } from '../components/QrThumb';

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Set by IntakePage's `navigate(..., { state: { justCreated: true } })`
  // after saving a new item — surfaces a "Print QR" shortcut so the user
  // doesn't have to hunt for the sticker after the signature intake flow.
  const [justCreatedToastOpen, setJustCreatedToastOpen] = useState(
    Boolean((location.state as { justCreated?: boolean } | null)?.justCreated),
  );

  const itemQuery = useQuery({
    queryKey: ['items', id],
    queryFn: () => fetchItem(id as string),
    enabled: Boolean(id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteItem(id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      navigate('/');
    },
    onError: (error: unknown) => {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete item');
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
  // `path` is a materialized path whose last segment is the current location's
  // own slug (e.g. 'garage.cabinet-3' for 'Cabinet 3'), so drop it — the leaf
  // is rendered separately below via `item.location.name`.
  const locationSegments = item.location ? item.location.path.split('.').slice(0, -1) : [];

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button startIcon={<EditOutlinedIcon />} onClick={() => navigate(`/items/${item.id}/edit`)}>
          Edit
        </Button>
        <Button
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
            bgcolor: 'grey.100',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Inventory2OutlinedIcon sx={{ fontSize: 48, color: 'grey.400' }} />
        </Box>
      )}

      <Box>
        <Typography variant="h5" component="h1" gutterBottom>
          {item.name}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Qty: {item.quantity}
          {item.unit ? ` ${item.unit}` : ''}
        </Typography>
        {item.description && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {item.description}
          </Typography>
        )}
      </Box>

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
    </Stack>
  );
}
