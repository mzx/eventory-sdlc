import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, Navigate, useParams } from 'react-router-dom';
import { fetchByQr, QrLookupNotFoundError } from '../api';
import { wsKey } from '../lib/queryKeys';
import { useActiveWorkspaceId } from '../workspace/useActiveWorkspace';

/**
 * `/r/:token` — the QR sticker landing route (EVT-13). Stickers (`GET
 * /api/qr/:token`, EVT-8) encode `${PUBLIC_BASE_URL}/r/:token`; this page
 * resolves the token via `GET /api/items/by-qr/:token` and redirects to the
 * matching item or location detail page. This is the phone-camera entry
 * point into the app, so the loading state is deliberately minimal (a single
 * spinner, no chrome) to feel instant.
 */
export function ScanPage() {
  const { token } = useParams<{ token: string }>();
  // Deliberately NOT gated on `workspaceId != null` (unlike every other
  // workspace-scoped query in this app) — the server resolves a scanned
  // token against the SCANNED resource's own workspace, not the caller's
  // active one (see apps/api's `@AllowMissingWorkspace()` doc comment on
  // `ItemsController.findByQr`), so this must work before/without an active
  // selection too. `wsKey` is still used for cache-key consistency/audit
  // (EVT-43 AC1) even though the fetch itself doesn't depend on it.
  const workspaceId = useActiveWorkspaceId();

  const query = useQuery({
    queryKey: wsKey(workspaceId, 'scan', token),
    queryFn: () => fetchByQr(token as string),
    enabled: Boolean(token),
    retry: false,
  });

  if (query.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress data-testid="scan-loading" />
      </Box>
    );
  }

  if (query.isError) {
    const notFound = query.error instanceof QrLookupNotFoundError;
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: 8, textAlign: 'center' }}>
        <Typography variant="h5" component="h1">
          {notFound ? 'Unknown code' : 'Something went wrong'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          {notFound
            ? "This QR code doesn't match anything in your inventory. It may be damaged, mistyped, or from a different Eventory instance."
            : /* Deliberately static rather than rendering `query.error.message`,
               * which would otherwise echo the raw scanned token (from the URL
               * path, not user-typed input, but still untrusted external data)
               * back onto the page. */
              'We could not check this code right now. Please try again in a moment.'}
        </Typography>
        <Button component={RouterLink} to="/" variant="contained">
          Go home
        </Button>
      </Stack>
    );
  }

  if (!query.data) {
    return null;
  }

  const destination =
    query.data.kind === 'item'
      ? `/items/${query.data.item.id}`
      : `/locations/${query.data.location.id}`;

  return <Navigate to={destination} replace />;
}
