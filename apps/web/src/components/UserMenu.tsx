import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import {
  Avatar,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useState, type MouseEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { authLogoutUrl, type AuthUser } from '../api';

/** Renders `name`'s initial, or `?` when both `name` and `email` are absent. */
function initial(user: AuthUser): string {
  return (user.name ?? user.email ?? '?').trim().charAt(0).toUpperCase();
}

/**
 * AppBar avatar menu: name/email header, "Admin → Users" (admins only),
 * logout, and a non-interactive build-version footer (EVT-34). `user` is
 * always approved here — `AuthGate` never renders the app shell (and
 * therefore this menu) for a pending/rejected/signed-out user.
 *
 * `version` defaults to the build-time `__BUILD_VERSION__` global (see
 * vite.config.ts / vite-config/build-version.ts) — `994831b · 2026-08-14`
 * for a deploy.sh build, `dev` for `vite dev` / dev compose. It's an
 * explicit prop (rather than reading the global directly in the JSX below)
 * purely so tests can exercise both the real-version and `dev`-marker
 * render paths without needing to fake the Vite `define` substitution.
 */
export function UserMenu({
  user,
  version = __BUILD_VERSION__,
}: {
  user: AuthUser;
  version?: string;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <IconButton onClick={handleOpen} size="small" aria-label="account menu" sx={{ ml: 1 }}>
        {user.picture ? (
          <Avatar src={user.picture} alt={user.name ?? user.email} sx={{ width: 32, height: 32 }} />
        ) : (
          <Avatar sx={{ width: 32, height: 32 }}>{initial(user)}</Avatar>
        )}
      </IconButton>
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <Typography variant="body2" noWrap>
            {user.name ?? user.email}
          </Typography>
        </MenuItem>
        <Divider />
        {user.role === 'admin' && (
          <MenuItem component={RouterLink} to="/admin/users" onClick={handleClose}>
            <ListItemIcon>
              <AdminPanelSettingsOutlinedIcon fontSize="small" />
            </ListItemIcon>
            Admin &rsaquo; Users
          </MenuItem>
        )}
        <MenuItem component="a" href={authLogoutUrl()}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Log out
        </MenuItem>
        <Divider />
        <MenuItem disabled aria-label="build version" sx={{ opacity: '1 !important' }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {version}
          </Typography>
        </MenuItem>
      </Menu>
    </>
  );
}
