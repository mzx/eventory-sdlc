import GoogleIcon from '@mui/icons-material/Google';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { authGoogleUrl } from '../api';

/**
 * Shown by `AuthGate` whenever there is no signed-in user (never visited,
 * logged out, or session expired). Not a router route — `AuthGate` renders
 * it in place of the app shell so a signed-out visit to ANY path shows this
 * without ever flashing app content (EVT-15 AC1).
 */
export function LoginPage() {
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
            href={authGoogleUrl()}
            fullWidth
          >
            Sign in with Google
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
