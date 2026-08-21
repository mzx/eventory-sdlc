import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  changeWorkspaceMemberRole,
  createWorkspaceInvite,
  deleteWorkspace,
  fetchItems,
  fetchWorkspaceInvites,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  renameWorkspace,
  revokeWorkspaceInvite,
  type InvitableWorkspaceRole,
  type WorkspaceInviteWithToken,
  type WorkspaceMemberRow,
  type WorkspaceRole,
} from '../api';
import { wsKey } from '../lib/queryKeys';
import {
  useActiveWorkspaceId,
  useActiveWorkspaceRole,
  useMyWorkspaces,
  WORKSPACES_QUERY_KEY,
} from '../workspace/useActiveWorkspace';

/**
 * `Record<WorkspaceRole, string>` (round-2 review, suggestion 9) rather than
 * `Record<string, string>` — a future role added to the union without a
 * matching entry here now fails to compile instead of silently falling back
 * to the `?? member.role` raw-value display at each call site.
 */
const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Viewer',
};

/**
 * `/settings/members` (EVT-43 AC5) — owners manage the roster + invites for
 * the active workspace. Reachable by any member (mirrors apps/api
 * `WorkspacesService.listMembers`'s "any member may view" rule), but
 * role-toggle/remove/invite-management are owner-only, hidden here — the
 * server independently 403s a non-owner attempt via `requireOwner`, so this
 * is UI convenience, not the enforcement boundary.
 */
export function MembersSettingsPage() {
  const workspaceId = useActiveWorkspaceId();
  const role = useActiveWorkspaceRole();
  const isOwner = role === 'owner';
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Backs the rename form + the delete-confirmation "type the name" check
  // (AC1/AC5) — `useMyWorkspaces` is the SAME cache every other consumer
  // (app bar, switcher, this page) reads, so invalidating it after a
  // rename/delete updates all of them without a reload.
  const workspacesQuery = useMyWorkspaces();
  const activeWorkspace = workspacesQuery.data?.find((w) => w.id === workspaceId) ?? null;

  function invalidateWorkspaces() {
    return queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
  }

  // -------------------------------------------------------------------------
  // rename (EVT-47 AC1) — `nameDraft` stays `null` ("follow the server
  // value") until the owner actually types; this way a background refetch
  // (e.g. another tab renaming it) never clobbers unsaved input, and a
  // successful save resets to `null` so the field reflects the fresh cache
  // entry rather than a second, now-redundant local copy of it.
  // -------------------------------------------------------------------------
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const displayedName = nameDraft ?? activeWorkspace?.name ?? '';
  const trimmedDraft = displayedName.trim();
  const renameMutation = useMutation({
    mutationFn: (name: string) => renameWorkspace(workspaceId as string, name),
    onSuccess: () => {
      setNameDraft(null);
      return invalidateWorkspaces();
    },
  });

  // -------------------------------------------------------------------------
  // delete (EVT-47 AC2/AC4/AC5/AC6)
  // -------------------------------------------------------------------------
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openDeleteDialog() {
    setConfirmName('');
    setDeleteError(null);
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog() {
    setDeleteDialogOpen(false);
  }

  // Approximate counts for the confirmation dialog (AC5) — reuses the
  // already-existing item list endpoint rather than adding a dedicated
  // counts endpoint; only fetched once the dialog is actually open. Photo
  // count is a deliberate UNDER-count (primary photos only, not every photo
  // an item has) — the task explicitly allows "fetchable or approximate".
  const deletionPreviewQuery = useQuery({
    queryKey: wsKey(workspaceId, 'workspace-deletion-preview'),
    queryFn: () => fetchItems(),
    enabled: deleteDialogOpen && workspaceId != null,
  });
  const approxItemCount = deletionPreviewQuery.data?.length ?? null;
  const approxPhotoCount =
    deletionPreviewQuery.data?.filter((item) => item.primaryPhoto != null).length ?? null;

  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkspace(workspaceId as string),
    onSuccess: () => {
      setDeleteDialogOpen(false);
      setDeleteError(null);
      void invalidateWorkspaces();
      // The workspace this page was showing no longer exists — land
      // somewhere coherent rather than a settings page for a workspace
      // that's gone. `useMyWorkspaces`'s own fallback effect (re-run by the
      // invalidation above) picks another membership, or — if that was the
      // caller's last one — AppShell's zero-membership check renders
      // OnboardingPage regardless of route (AC6).
      navigate('/');
    },
    onError: (err: unknown) =>
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete workspace'),
  });
  const canConfirmDelete =
    activeWorkspace != null &&
    confirmName.trim() === activeWorkspace.name &&
    !deleteMutation.isPending;

  const membersQuery = useQuery({
    queryKey: wsKey(workspaceId, 'workspace-members'),
    queryFn: () => fetchWorkspaceMembers(workspaceId as string),
    enabled: workspaceId != null,
  });

  const invitesQuery = useQuery({
    queryKey: wsKey(workspaceId, 'workspace-invites'),
    queryFn: () => fetchWorkspaceInvites(workspaceId as string),
    enabled: workspaceId != null && isOwner,
  });

  const members = membersQuery.data ?? [];
  const invites = invitesQuery.data ?? [];
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  function invalidateMembers() {
    return queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'workspace-members') });
  }

  function invalidateInvites() {
    return queryClient.invalidateQueries({ queryKey: wsKey(workspaceId, 'workspace-invites') });
  }

  const roleMutation = useMutation({
    mutationFn: ({ userId, role: newRole }: { userId: string; role: InvitableWorkspaceRole }) =>
      changeWorkspaceMemberRole(workspaceId as string, userId, newRole),
    onSuccess: invalidateMembers,
  });

  const [removeTarget, setRemoveTarget] = useState<WorkspaceMemberRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(workspaceId as string, userId),
    onSuccess: () => {
      setRemoveTarget(null);
      setRemoveError(null);
      return invalidateMembers();
    },
    onError: (err: unknown) =>
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove member'),
  });

  const [inviteRole, setInviteRole] = useState<InvitableWorkspaceRole>('member');
  const [createdInvite, setCreatedInvite] = useState<WorkspaceInviteWithToken | null>(null);
  const [copied, setCopied] = useState(false);
  const createInviteMutation = useMutation({
    mutationFn: () => createWorkspaceInvite(workspaceId as string, inviteRole),
    onSuccess: (invite) => {
      setCreatedInvite(invite);
      setCopied(false);
      return invalidateInvites();
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => revokeWorkspaceInvite(workspaceId as string, inviteId),
    onSuccess: invalidateInvites,
  });

  function inviteLink(token: string): string {
    return `${window.location.origin}/invite/${token}`;
  }

  async function copyInviteLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(true);
    } catch {
      // Clipboard API unavailable (permissions, non-HTTPS, some test
      // environments) — the link is still shown as selectable text.
    }
  }

  if (membersQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (membersQuery.isError) {
    return (
      <Alert severity="error">
        {membersQuery.error instanceof Error
          ? membersQuery.error.message
          : 'Failed to load members'}
      </Alert>
    );
  }

  return (
    <Stack spacing={3}>
      {isOwner && (
        <>
          <Box>
            <Typography variant="h5" component="h1" gutterBottom>
              Workspace
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" gap={1.5}>
              <TextField
                size="small"
                label="Workspace name"
                value={displayedName}
                onChange={(e) => setNameDraft(e.target.value)}
                sx={{ minWidth: 240 }}
                inputProps={{ 'aria-label': 'Workspace name' }}
              />
              <Button
                variant="contained"
                onClick={() => trimmedDraft && renameMutation.mutate(trimmedDraft)}
                disabled={
                  renameMutation.isPending ||
                  !trimmedDraft ||
                  trimmedDraft === activeWorkspace?.name
                }
                sx={{ minHeight: 40 }}
              >
                Save
              </Button>
            </Stack>
            {renameMutation.isError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {renameMutation.error instanceof Error
                  ? renameMutation.error.message
                  : 'Failed to rename workspace'}
              </Alert>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Danger zone
            </Typography>
            <Button
              color="error"
              variant="outlined"
              startIcon={<DeleteOutlineIcon />}
              onClick={openDeleteDialog}
            >
              Delete workspace
            </Button>
          </Box>

          <Divider />
        </>
      )}

      <Typography variant="h5" component="h1">
        Members
      </Typography>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label="workspace members">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              {isOwner && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => {
              const isLastOwner = member.role === 'owner' && ownerCount <= 1;
              return (
                <TableRow key={member.userId}>
                  <TableCell>{member.name ?? '—'}</TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    {isOwner && member.role !== 'owner' ? (
                      <TextField
                        select
                        size="small"
                        value={member.role}
                        label={`Role for ${member.name ?? member.email}`}
                        onChange={(e) =>
                          roleMutation.mutate({
                            userId: member.userId,
                            role: e.target.value as InvitableWorkspaceRole,
                          })
                        }
                        disabled={roleMutation.isPending}
                        sx={{ minWidth: 120 }}
                      >
                        <MenuItem value="member">Member</MenuItem>
                        <MenuItem value="viewer">Viewer</MenuItem>
                      </TextField>
                    ) : (
                      <Chip size="small" label={ROLE_LABEL[member.role] ?? member.role} />
                    )}
                  </TableCell>
                  {isOwner && (
                    <TableCell align="right">
                      <Tooltip
                        title={
                          isLastOwner
                            ? 'Cannot remove or demote the last owner — transfer ownership first'
                            : 'Remove from workspace'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            aria-label={`Remove ${member.name ?? member.email}`}
                            onClick={() => {
                              setRemoveError(null);
                              setRemoveTarget(member);
                            }}
                            disabled={isLastOwner}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>

      {isOwner && (
        <>
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Invite someone
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" gap={1.5}>
              <TextField
                select
                size="small"
                label="Role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitableWorkspaceRole)}
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="member">Member</MenuItem>
                <MenuItem value="viewer">Viewer</MenuItem>
              </TextField>
              <Button
                variant="contained"
                onClick={() => createInviteMutation.mutate()}
                disabled={createInviteMutation.isPending}
                sx={{ minHeight: 44 }}
              >
                Create invite
              </Button>
            </Stack>
            {createInviteMutation.isError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {createInviteMutation.error instanceof Error
                  ? createInviteMutation.error.message
                  : 'Failed to create invite'}
              </Alert>
            )}
            {createdInvite && (
              <Alert severity="success" sx={{ mt: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {inviteLink(createdInvite.token)}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label="Copy invite link"
                    onClick={() => void copyInviteLink(createdInvite.token)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                  {copied && <Typography variant="caption">Copied!</Typography>}
                </Stack>
              </Alert>
            )}
          </Box>

          {invites.length > 0 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Pending invites
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="workspace invites">
                  <TableHead>
                    <TableRow>
                      <TableCell>Role</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Expires</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {invites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{ROLE_LABEL[invite.role] ?? invite.role}</TableCell>
                        <TableCell>{invite.status}</TableCell>
                        <TableCell>{new Date(invite.expiresAt).toLocaleDateString()}</TableCell>
                        <TableCell align="right">
                          {invite.status === 'pending' && (
                            <Button
                              size="small"
                              onClick={() => revokeInviteMutation.mutate(invite.id)}
                              disabled={revokeInviteMutation.isPending}
                            >
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}
        </>
      )}

      <Dialog open={removeTarget !== null} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>Remove {removeTarget?.name ?? removeTarget?.email}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            They will lose access to this workspace&rsquo;s inventory immediately.
          </DialogContentText>
          {removeError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {removeError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => removeTarget && removeMutation.mutate(removeTarget.userId)}
            disabled={removeMutation.isPending}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={closeDeleteDialog}>
        <DialogTitle>Delete &ldquo;{activeWorkspace?.name}&rdquo;?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes ALL items, photos, locations, categories, tags, projects, and
            shopping-list history in this workspace, for every member — there is no undo.
          </DialogContentText>
          <DialogContentText sx={{ mt: 1.5 }}>
            {deletionPreviewQuery.isLoading
              ? 'Checking what will be destroyed…'
              : `This will destroy approximately ${approxItemCount ?? 0} item(s) and at least ${approxPhotoCount ?? 0} photo(s).`}
          </DialogContentText>
          <TextField
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label={`Type "${activeWorkspace?.name ?? ''}" to confirm`}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            inputProps={{ 'aria-label': 'Confirm workspace name' }}
          />
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          {/* `autoFocus` — cancel is the default-focused action on a
           * destructive confirmation dialog (AC5, GitHub-style). */}
          <Button onClick={closeDeleteDialog} autoFocus>
            Cancel
          </Button>
          <Button
            color="error"
            onClick={() => deleteMutation.mutate()}
            disabled={!canConfirmDelete}
          >
            Delete forever
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
