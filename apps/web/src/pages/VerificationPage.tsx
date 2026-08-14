import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Link,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { countItem, fetchVerificationQueue, photoUrl, type VerificationQueueRow } from '../api';
import { CountDialog } from '../components/CountDialog';

/** "3 days overdue" / "Due today" summary line. */
function overdueSummary(row: VerificationQueueRow): string {
  if (row.daysOverdue <= 0) return 'Due today';
  return row.daysOverdue === 1 ? '1 day overdue' : `${row.daysOverdue} days overdue`;
}

function rowSummary(row: VerificationQueueRow): string {
  const parts = [overdueSummary(row)];
  if (row.location) {
    parts.push(row.location.name);
  }
  return parts.join(' — ');
}

/**
 * `/verification` — "today's count list" (EVT-27 AC 3): items on a count
 * schedule whose next count is past due, most-overdue first, capped at 20
 * server-side. Each row's "Count" action opens the same blind-entry
 * `CountDialog` used on `ItemDetailPage`'s "Verify count" affordance.
 */
export function VerificationPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ['verification-queue'],
    queryFn: fetchVerificationQueue,
  });

  const [countTarget, setCountTarget] = useState<VerificationQueueRow | null>(null);
  const countMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      countItem(itemId, quantity),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      return result;
    },
  });

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
          : 'Failed to load the verification queue'}
      </Alert>
    );
  }

  const rows = listQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Verification
      </Typography>

      {rows.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
          <Typography variant="h6" gutterBottom>
            Nothing due
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every item on a count schedule has been verified on time. Set a count interval on an
            item to add it to this list.
          </Typography>
        </Box>
      )}

      {rows.length > 0 && (
        <List disablePadding aria-label="verification queue">
          {rows.map((row) => (
            // A flex row rather than `secondaryAction` (which only reserves
            // 48px) — the "Count" button is ~90px+ and would otherwise
            // overlap the item name at 390px (2026-08-14 mobile audit
            // finding #6). `minWidth: 0` on ListItemText plus `noWrap` on
            // both lines lets long names/summaries truncate with an
            // ellipsis instead of pushing the button off-row.
            <ListItem key={row.id} divider sx={{ gap: 1.5, alignItems: 'center' }}>
              <ListItemAvatar>
                {row.primaryPhoto ? (
                  <Avatar
                    variant="rounded"
                    src={photoUrl(row.primaryPhoto.filename)}
                    alt={row.name}
                  />
                ) : (
                  <Avatar variant="rounded">
                    <Inventory2OutlinedIcon />
                  </Avatar>
                )}
              </ListItemAvatar>
              <ListItemText
                sx={{ minWidth: 0 }}
                primary={
                  <Link
                    component={RouterLink}
                    to={`/items/${row.id}`}
                    underline="hover"
                    noWrap
                    sx={{ display: 'block' }}
                  >
                    {row.name}
                  </Link>
                }
                secondary={rowSummary(row)}
                slotProps={{ secondary: { noWrap: true } }}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={() => setCountTarget(row)}
                sx={{ flexShrink: 0 }}
              >
                Count
              </Button>
            </ListItem>
          ))}
        </List>
      )}

      <CountDialog
        open={countTarget !== null}
        itemName={countTarget?.name ?? ''}
        onCount={(quantity) => countMutation.mutateAsync({ itemId: countTarget!.id, quantity })}
        onClose={() => setCountTarget(null)}
      />
    </Stack>
  );
}
