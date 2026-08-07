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
 * AppBar avatar menu: name/email header, "Admin → Users" (admins only), and
 * logout. `user` is always approved here — `AuthGate` never renders the app
 * shell (and therefore this menu) for a pending/rejected/signed-out user.
 */
export function UserMenu({ user }: { user: AuthUser }) {
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
      </Menu>
    </>
  );
}
