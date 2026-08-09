import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { frostedPanel } from '../theme';
import {
  fetchUsers,
  updateUserRole,
  updateUserStatus,
  type AdminUserRow,
  type UserRole,
  type UserStatus,
} from '../api';
import { useAuth } from '../auth/AuthContext';

const STATUS_COLOR: Record<UserStatus, 'default' | 'success' | 'error' | 'warning'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

/** A single row's approve/reject actions + role toggle, each an optimistic mutation. */
function UserRowActions({ row, isSelf }: { row: AdminUserRow; isSelf: boolean }) {
  const queryClient = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (status: UserStatus) => updateUserStatus(row.id, status),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: ['users'] });
      const previous = queryClient.getQueryData<AdminUserRow[]>(['users']);
      queryClient.setQueryData<AdminUserRow[]>(['users'], (rows) =>
        (rows ?? []).map((r) => (r.id === row.id ? { ...r, status } : r)),
      );
      return { previous };
    },
    onError: (_err, _status, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['users'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const roleMutation = useMutation({
    mutationFn: (role: UserRole) => updateUserRole(row.id, role),
    onMutate: async (role) => {
      await queryClient.cancelQueries({ queryKey: ['users'] });
      const previous = queryClient.getQueryData<AdminUserRow[]>(['users']);
      queryClient.setQueryData<AdminUserRow[]>(['users'], (rows) =>
        (rows ?? []).map((r) => (r.id === row.id ? { ...r, role } : r)),
      );
      return { previous };
    },
    onError: (_err, _role, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['users'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const busy = statusMutation.isPending || roleMutation.isPending;

  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
      {row.status !== 'approved' && (
        <Tooltip title="Approve">
          <span>
            <IconButton
              aria-label={`Approve ${row.email}`}
              color="success"
              size="small"
              disabled={busy}
              onClick={() => statusMutation.mutate('approved')}
            >
              <CheckCircleOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {row.status !== 'rejected' && (
        <Tooltip title={isSelf ? "Admins can't reject themselves" : 'Reject'}>
          <span>
            <IconButton
              aria-label={`Reject ${row.email}`}
              color="error"
              size="small"
              disabled={busy || isSelf}
              onClick={() => statusMutation.mutate('rejected')}
            >
              <HighlightOffIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <Tooltip title={isSelf ? "Admins can't demote themselves" : 'Toggle admin role'}>
        <span>
          <Switch
            inputProps={{ 'aria-label': `Admin role for ${row.email}` }}
            size="small"
            checked={row.role === 'admin'}
            disabled={busy || isSelf}
            onChange={(e) => roleMutation.mutate(e.target.checked ? 'admin' : 'user')}
          />
        </span>
      </Tooltip>
    </Stack>
  );
}

/**
 * `/admin/users` — table of every household member with approve/reject and
 * role-toggle actions. `App.tsx` redirects non-admins away before this ever
 * mounts (EVT-15 AC3), but the page also renders nothing useful for a
 * non-admin's own row set since `GET /api/users` itself is admin-only.
 */
export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  const rows = usersQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Users
      </Typography>

      {usersQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {usersQuery.isError && (
        <Alert severity="error">
          {usersQuery.error instanceof Error ? usersQuery.error.message : 'Failed to load users'}
        </Alert>
      )}

      {usersQuery.isSuccess && (
        <Box sx={{ ...frostedPanel, overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Last login</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="admin-user-row">
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar src={row.picture ?? undefined} sx={{ width: 28, height: 28 }}>
                        {(row.name ?? row.email).charAt(0).toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body2">{row.name ?? row.email}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.email}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={row.status} color={STATUS_COLOR[row.status]} />
                  </TableCell>
                  <TableCell>{row.role}</TableCell>
                  <TableCell>{formatDate(row.lastLoginAt)}</TableCell>
                  <TableCell align="right">
                    <UserRowActions row={row} isSelf={row.id === currentUser?.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}
