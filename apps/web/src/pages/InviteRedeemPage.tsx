import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { redeemInvite, setActiveWorkspaceId } from '../api';
import { useMyWorkspaces } from '../workspace/useActiveWorkspace';

/**
 * `/invite/:token` (EVT-43 AC4) — redemption route. `AuthGate` (mounted
 * above the whole router, see App.tsx) already guarantees a signed-in,
 * non-rejected caller ever reaches this component: a signed-out visit shows
 * `LoginPage` instead, which stashes this token (see
 * `workspace/useActiveWorkspace.ts`'s pending-invite helpers) and forwards
 * it through the Google OAuth round trip so redemption resumes here once
 * signed in — "sign-in-if-needed → redeem → land in the workspace".
 *
 * Attempts redemption once, automatically, on mount — no extra "are you
 * sure?" tap, matching `WorkspacesController`'s `POST /api/invites/redeem`
 * being idempotent for an already-member caller (see apps/api
 * `InvitesService.redeem`'s doc comment). A zero-membership caller
 * redeeming their very first invite is exactly the case `useMyWorkspaces()`'s
 * `@AllowMissingWorkspace()`-backed query already handles without a
 * workspace header.
 */
export function InviteRedeemPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refetch } = useMyWorkspaces();
  const [status, setStatus] = useState<'pending' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError('Missing invite token');
      setStatus('error');
      return;
    }
    void (async () => {
      try {
        const result = await redeemInvite(token);
        if (cancelled) return;
        // Refetch BEFORE switching — see `OnboardingPage.handleCreate`'s
        // identical comment: `useMyWorkspaces()`'s self-healing effect
        // would otherwise revert this selection against the still-stale
        // (pre-redemption) cached list, and — for a caller who already
        // belongs to OTHER workspaces — could even land them in the wrong
        // one instead of the one they just redeemed into.
        await refetch();
        if (cancelled) return;
        setActiveWorkspaceId(result.workspaceId);
        navigate('/', { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to redeem invite');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately only re-runs on `token` — `navigate`/`refetch` are stable
    // enough for this one-shot redemption attempt, and including them would
    // risk re-running on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (status === 'pending') {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        px: 2,
      }}
    >
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <Stack spacing={2} alignItems="center">
          <Typography variant="h6" component="h1">
            Couldn&rsquo;t join that workspace
          </Typography>
          <Alert severity="error" sx={{ width: '100%' }}>
            {error}
          </Alert>
          <Button variant="contained" onClick={() => navigate('/')}>
            Go home
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
