import GoogleIcon from '@mui/icons-material/Google';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { authGoogleUrl } from '../api';
import { setPendingInviteToken } from '../workspace/useActiveWorkspace';

/** Matches `/invite/:token` — deliberately mirrors `App.tsx`'s route, not a shared constant, since neither side needs the other to change in lockstep. */
const INVITE_PATH_RE = /^\/invite\/([^/]+)/;

/**
 * Shown by `AuthGate` whenever there is no signed-in user (never visited,
 * logged out, or session expired). Not a router route — `AuthGate` renders
 * it in place of the app shell so a signed-out visit to ANY path shows this
 * without ever flashing app content (EVT-15 AC1).
 *
 * EVT-43 AC4 "sign-in-if-needed" — a signed-out visit to `/invite/:token`
 * lands here (like every other path); this stashes the token (survives the
 * Google OAuth full-page round trip, which always redirects back to `/`
 * regardless of the original path — see apps/api
 * `AuthController.googleCallback`) so `AppShell` can resume redemption once
 * signed in, and forwards it as `?invite=` so a not-yet-allowlisted invitee
 * can complete their first sign-in at all (EVT-45's `GoogleSignInGuard`).
 */
export function LoginPage() {
  const location = useLocation();
  const inviteToken = INVITE_PATH_RE.exec(location.pathname)?.[1];

  useEffect(() => {
    if (inviteToken) {
      setPendingInviteToken(inviteToken);
    }
  }, [inviteToken]);

  const googleUrl = inviteToken
    ? `${authGoogleUrl()}?invite=${encodeURIComponent(inviteToken)}`
    : authGoogleUrl();

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
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 360, width: '100%', textAlign: 'center' }}>
        <Stack spacing={3} alignItems="center">
          <Typography variant="h5" component="h1">
            Eventory
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in with your household Google account to continue.
          </Typography>
          {/* Full-page navigation (not a client-side route) — the API
           * redirects to Google and back via a server-set session cookie. */}
          <Button
            variant="contained"
            size="large"
            startIcon={<GoogleIcon />}
            href={googleUrl}
            fullWidth
          >
            Sign in with Google
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
