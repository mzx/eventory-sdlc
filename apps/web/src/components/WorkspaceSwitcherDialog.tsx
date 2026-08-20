import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { createWorkspace, setActiveWorkspaceId } from '../api';
import { useMyWorkspaces } from '../workspace/useActiveWorkspace';

/**
 * Shared workspace picker + create-workspace form (EVT-43 AC3) — rendered
 * from both the desktop avatar menu (`UserMenu`) and the mobile bottom-nav
 * "More" overflow (`BottomNav`), so the switcher only needs to be built and
 * tested once. Reads/writes the same `useMyWorkspaces()`/`setActiveWorkspaceId`
 * plumbing every page's query keys are scoped against — picking a workspace
 * here is exactly what makes every other page's cache swap (AC1/AC2).
 */
export function WorkspaceSwitcherDialog({
  open,
  onClose,
  activeWorkspaceId,
}: {
  open: boolean;
  onClose: () => void;
  activeWorkspaceId: string | null;
}) {
  const { data: workspaces, isLoading, refetch } = useMyWorkspaces();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleClose() {
    setCreating(false);
    setNewName('');
    setError(null);
    onClose();
  }

  function handleSwitch(id: string) {
    setActiveWorkspaceId(id);
    handleClose();
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const created = await createWorkspace(trimmed);
      // Refetch BEFORE switching — `useMyWorkspaces()`'s self-healing effect
      // (see its doc comment) re-validates the active id against the
      // CACHED list on every id change; if that cache is still the
      // pre-create snapshot, it won't find `created.id` in it and will
      // immediately revert the selection back to the old default. Fetching
      // fresh data first means the effect finds `created.id` already
      // present and leaves it alone.
      await refetch();
      setActiveWorkspaceId(created.id);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Switch workspace</DialogTitle>
      <DialogContent>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        <List aria-label="my workspaces">
          {(workspaces ?? []).map((ws) => (
            <ListItemButton
              key={ws.id}
              selected={ws.id === activeWorkspaceId}
              onClick={() => handleSwitch(ws.id)}
            >
              <ListItemText primary={ws.name} secondary={ws.role} />
            </ListItemButton>
          ))}
        </List>
        {creating ? (
          <Box sx={{ mt: 2 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Workspace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
            />
            {error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}
          </Box>
        ) : (
          <Button onClick={() => setCreating(true)} sx={{ mt: 2 }}>
            Create workspace
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
        {creating && (
          <Button
            variant="contained"
            onClick={() => void handleCreate()}
            disabled={pending || newName.trim().length === 0}
          >
            Create
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
