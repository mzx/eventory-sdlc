import { Alert, Box, Button, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { authLogoutUrl, createWorkspace, redeemInvite, setActiveWorkspaceId } from '../api';
import { useMyWorkspaces } from '../workspace/useActiveWorkspace';

/**
 * Shown by `AppShell` (EVT-43 AC4) in place of the routed app whenever the
 * signed-in, approved caller belongs to zero workspaces — this REPLACES the
 * old global-approval `PendingPage` experience for that case (EVT-42 retired
 * the "wait for an admin to approve you" gate; a brand-new sign-in is
 * `approved` immediately but still needs to create or join a workspace
 * before any inventory route resolves — see apps/api
 * `WorkspaceContextGuard`'s fail-closed doc comment).
 *
 * Two independent paths, either of which lands the caller in the app:
 * - Create a new workspace (becomes its owner).
 * - Redeem an invite token shared out-of-band by an existing owner — the
 *   same action `InviteRedeemPage` performs at `/invite/:token`; this is the
 *   "I already have a token, just let me paste it" shortcut for a caller who
 *   landed here directly instead of following the link.
 */
export function OnboardingPage() {
  const { refetch } = useMyWorkspaces();

  const [workspaceName, setWorkspaceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [inviteToken, setInviteToken] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = workspaceName.trim();
    if (!trimmed) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createWorkspace(trimmed);
      // Refetch BEFORE switching — see `WorkspaceSwitcherDialog.handleCreate`'s
      // identical comment: `useMyWorkspaces()`'s self-healing effect would
      // otherwise revert this selection the instant it re-validates against
      // the still-stale (pre-create) cached list.
      await refetch();
      setActiveWorkspaceId(created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }

  async function handleRedeem() {
    const trimmed = inviteToken.trim();
    if (!trimmed) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      const result = await redeemInvite(trimmed);
      await refetch();
      setActiveWorkspaceId(result.workspaceId);
    } catch (err) {
      setRedeemError(err instanceof Error ? err.message : 'Failed to redeem invite');
    } finally {
      setRedeeming(false);
    }
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
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 440, width: '100%' }}>
        <Stack spacing={3}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" component="h1">
              Welcome to Eventory
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Create a household workspace, or redeem an invite from someone who already has one.
            </Typography>
          </Box>

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Create a workspace</Typography>
            <TextField
              size="small"
              label="Workspace name"
              placeholder="e.g. The Smith Household"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
              fullWidth
            />
            {createError && <Alert severity="error">{createError}</Alert>}
            <Button
              variant="contained"
              onClick={() => void handleCreate()}
              disabled={creating || workspaceName.trim().length === 0}
              sx={{ minHeight: 44 }}
            >
              Create workspace
            </Button>
          </Stack>

          <Divider>or</Divider>

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Redeem an invite</Typography>
            <TextField
              size="small"
              label="Invite token"
              placeholder="Paste the token you were sent"
              value={inviteToken}
              onChange={(e) => setInviteToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRedeem();
              }}
              fullWidth
            />
            {redeemError && <Alert severity="error">{redeemError}</Alert>}
            <Button
              variant="outlined"
              onClick={() => void handleRedeem()}
              disabled={redeeming || inviteToken.trim().length === 0}
              sx={{ minHeight: 44 }}
            >
              Redeem invite
            </Button>
          </Stack>

          <Button variant="text" href={authLogoutUrl()} sx={{ alignSelf: 'center' }}>
            Log out
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
