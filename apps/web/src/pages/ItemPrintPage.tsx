import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchItem, qrImageUrl } from '../api';
import { wsKey } from '../lib/queryKeys';
import { useActiveWorkspaceId } from '../workspace/useActiveWorkspace';

/**
 * Minimal print view for an item's QR sticker, rendered outside the app
 * shell (no AppBar) so `window.print()` — and physically printing — only
 * produces the sticker + item name. Opened in a new tab by `QrThumb`'s
 * print button (see `apps/web/src/components/QrThumb.tsx`).
 *
 * The "Print" trigger button itself is marked `no-print` so it doesn't show
 * up in the printed output.
 */
export function ItemPrintPage() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = useActiveWorkspaceId();
  const itemQuery = useQuery({
    queryKey: wsKey(workspaceId, 'items', id),
    queryFn: () => fetchItem(id as string),
    enabled: Boolean(id) && workspaceId != null,
  });

  return (
    <Box
      sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <style>{'@media print { .no-print { display: none !important; } }'}</style>

      {itemQuery.isLoading && <CircularProgress className="no-print" />}

      {itemQuery.isError && (
        <Alert severity="error" className="no-print">
          {itemQuery.error instanceof Error ? itemQuery.error.message : 'Failed to load item'}
        </Alert>
      )}

      {itemQuery.data && (
        <Stack spacing={2} alignItems="center" sx={{ p: 3 }}>
          <Typography variant="h6" component="h1" align="center">
            {itemQuery.data.name}
          </Typography>
          <Box
            component="img"
            src={qrImageUrl(itemQuery.data.qrCode, 384)}
            alt="QR sticker"
            width={384}
            height={384}
            sx={{ maxWidth: '100%', height: 'auto' }}
          />
          <Button
            className="no-print"
            variant="contained"
            onClick={() => window.print()}
            data-testid="trigger-print"
          >
            Print
          </Button>
        </Stack>
      )}
    </Box>
  );
}
