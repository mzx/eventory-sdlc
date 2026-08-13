import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  fetchShoppingList,
  photoUrl,
  restockShoppingListEntry,
  type ShoppingListEntry,
} from '../api';

/** "2 / min 5 — Garage" style on-hand/min/location summary line (EVT-26 AC 4). */
function entrySummary(entry: ShoppingListEntry): string {
  const parts = [
    entry.item.minQuantity != null
      ? `${entry.item.quantity} / min ${entry.item.minQuantity}`
      : `${entry.item.quantity} on hand`,
  ];
  if (entry.item.location) {
    parts.push(entry.item.location.name);
  }
  return parts.join(' — ');
}

/**
 * `/shopping-list` — the personal e-kanban (EVT-26). Lists every open
 * shopping-list entry (manual "Running low" taps and auto-triggered
 * low-stock flags alike); "Restocked" records an `add` movement for the
 * freshly-counted quantity and closes the entry.
 */
export function ShoppingListPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: ['shopping-list'], queryFn: fetchShoppingList });

  const [restockTarget, setRestockTarget] = useState<ShoppingListEntry | null>(null);
  const [restockQuantity, setRestockQuantity] = useState('');
  const [restockError, setRestockError] = useState<string | null>(null);

  const restockMutation = useMutation({
    mutationFn: ({ entryId, quantity }: { entryId: string; quantity: number }) =>
      restockShoppingListEntry(entryId, quantity),
    onSuccess: (_result, { entryId }) => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
      // The restocked item's own detail/history view (AC 5: "the item's
      // badge/state updates without reload") reads these — a plain
      // ['items'] invalidation also covers the list/grid thumbnails.
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setRestockTarget((current) => (current?.id === entryId ? null : current));
      setRestockError(null);
    },
    onError: (error: unknown) => {
      setRestockError(error instanceof Error ? error.message : 'Failed to record restock');
    },
  });

  function openRestockDialog(entry: ShoppingListEntry) {
    setRestockTarget(entry);
    setRestockQuantity(String(entry.item.quantity));
    setRestockError(null);
  }

  function closeRestockDialog() {
    setRestockTarget(null);
    setRestockError(null);
  }

  if (listQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (listQuery.isError) {
    return (
      <Alert severity="error">
        {listQuery.error instanceof Error
          ? listQuery.error.message
          : 'Failed to load the shopping list'}
      </Alert>
    );
  }

  const entries = listQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Shopping List
      </Typography>

      {entries.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
          <Typography variant="h6" gutterBottom>
            You&rsquo;re all stocked up
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tap &ldquo;Running low&rdquo; on an item, or let Eventory flag it automatically once it
            drops below its minimum — either way, it shows up here.
          </Typography>
        </Box>
      )}

      {entries.length > 0 && (
        <List disablePadding aria-label="shopping list">
          {entries.map((entry) => (
            <ListItem
              key={entry.id}
              divider
              secondaryAction={
                <Button variant="outlined" size="small" onClick={() => openRestockDialog(entry)}>
                  Restocked
                </Button>
              }
            >
              <ListItemAvatar>
                {entry.item.primaryPhoto ? (
                  <Avatar
                    variant="rounded"
                    src={photoUrl(entry.item.primaryPhoto.filename)}
                    alt={entry.item.name}
                  />
                ) : (
                  <Avatar variant="rounded">
                    <Inventory2OutlinedIcon />
                  </Avatar>
                )}
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Link component={RouterLink} to={`/items/${entry.item.id}`} underline="hover">
                    {entry.item.name}
                  </Link>
                }
                secondary={entrySummary(entry)}
              />
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={restockTarget !== null} onClose={closeRestockDialog}>
        <DialogTitle>Restock {restockTarget?.item.name}</DialogTitle>
        <DialogContent>
          <DialogContentText>How many are on hand now?</DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="New quantity"
            type="number"
            fullWidth
            value={restockQuantity}
            onChange={(e) => setRestockQuantity(e.target.value)}
            inputProps={{ min: 0 }}
          />
          {restockError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {restockError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRestockDialog}>Cancel</Button>
          <Button
            variant="contained"
            disabled={restockMutation.isPending || restockQuantity.trim() === ''}
            onClick={() => {
              if (!restockTarget) return;
              restockMutation.mutate({
                entryId: restockTarget.id,
                quantity: Number(restockQuantity),
              });
            }}
          >
            Restocked
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
