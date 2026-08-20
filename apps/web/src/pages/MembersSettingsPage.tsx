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
import {
  changeWorkspaceMemberRole,
  createWorkspaceInvite,
  fetchWorkspaceInvites,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  type InvitableWorkspaceRole,
  type WorkspaceInviteWithToken,
  type WorkspaceMemberRow,
} from '../api';
import { wsKey } from '../lib/queryKeys';
import { useActiveWorkspaceId, useActiveWorkspaceRole } from '../workspace/useActiveWorkspace';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', member: 'Member', viewer: 'Viewer' };

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
    </Stack>
  );
}
