import AddIcon from '@mui/icons-material/Add';
import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import {
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
} from '@mui/material';
import { useState, type MouseEvent } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';

/**
 * The `BottomNavigation`'s rendered height in px (MUI's default), exported
 * so `App.tsx` can size the routed content's reserved bottom padding off
 * the same number instead of a decoupled hard-coded `64px` (round-2 review
 * suggestion, code-reviewer).
 */
export const BOTTOM_NAV_HEIGHT = 64;

/**
 * Phone-width primary nav (EVT-35 AC1/2/4) — a fixed bottom bar replacing
 * the AppBar toolbar's row of text buttons below the `md` breakpoint (see
 * `App.tsx`, which renders this only at xs/sm and hides it at md+).
 *
 * Five destinations: Items / Scan / Add / Shopping / More. Projects,
 * Locations, and Verification (not promoted to a slot of their own — the
 * workshop loop pins Scan/Add/Shopping as the highest-frequency actions)
 * live behind "More". The Shopping List count badges the Shopping icon
 * directly; the Verification count — otherwise invisible once demoted
 * into the More menu — badges the More icon instead, so neither count
 * silently disappears at phone width (AC1).
 */
export function BottomNav({
  openShoppingListCount,
  overdueVerificationCount,
  onScanClick,
}: {
  openShoppingListCount: number;
  overdueVerificationCount: number;
  onScanClick: () => void;
}) {
  const location = useLocation();
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const moreOpen = Boolean(moreAnchor);

  const closeMore = () => setMoreAnchor(null);
  const openMore = (event: MouseEvent<HTMLElement>) => setMoreAnchor(event.currentTarget);

  const moreRouteActive = ['/projects', '/locations', '/verification'].some((path) =>
    location.pathname.startsWith(path),
  );
  const value = moreRouteActive
    ? 'more'
    : location.pathname === '/intake'
      ? 'add'
      : location.pathname.startsWith('/shopping-list')
        ? 'shopping'
        : // startsWith (not ===) so nested item routes (`/items/:id`,
          // `/items/:id/edit`) keep Items highlighted too — round-2 review
          // finding.
          location.pathname === '/' || location.pathname.startsWith('/items')
          ? 'items'
          : false;

  return (
    <Paper
      role="navigation"
      aria-label="primary mobile navigation"
      elevation={0}
      square
      sx={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        display: { xs: 'block', md: 'none' },
        borderTop: '1px solid',
        borderColor: 'divider',
        // iOS standalone PWA safe-area inset (EVT-35 risk note / AC4) — a
        // no-op on browsers without a home-indicator gesture bar.
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      {/*
        No `onChange` here (round-2 review finding, code-reviewer): the
        Items/Add/Shopping actions below are `component={RouterLink}`, which
        already navigates on click. MUI fires the clicked action's `onClick`
        *then* `BottomNavigation`'s `onChange` regardless of
        `event.defaultPrevented`, so wiring both `RouterLink` navigation and
        an `onChange`-driven `navigate()` call double-navigates — two
        history entries per tap (concretely: from `/shopping-list`, tap
        `Items`, press back once, and you land on `/` instead of
        `/shopping-list`). `value` above is derived purely from
        `useLocation()`, so the selected tab still tracks the URL correctly
        without any `onChange` handler at all.
      */}
      <BottomNavigation value={value} showLabels>
        <BottomNavigationAction
          label="Items"
          value="items"
          icon={<Inventory2OutlinedIcon />}
          component={RouterLink}
          to="/"
          sx={{ minHeight: 44 }}
        />
        <BottomNavigationAction
          label="Scan"
          value="scan"
          icon={<QrCodeScannerOutlinedIcon />}
          onClick={onScanClick}
          sx={{ minHeight: 44 }}
        />
        <BottomNavigationAction
          label="Add"
          value="add"
          icon={<AddIcon />}
          component={RouterLink}
          to="/intake"
          sx={{ minHeight: 44 }}
        />
        <BottomNavigationAction
          label="Shopping"
          value="shopping"
          icon={
            <Badge badgeContent={openShoppingListCount} color="error">
              <ShoppingCartOutlinedIcon />
            </Badge>
          }
          component={RouterLink}
          to="/shopping-list"
          sx={{ minHeight: 44 }}
        />
        <BottomNavigationAction
          label="More"
          value="more"
          icon={
            <Badge badgeContent={overdueVerificationCount} color="error">
              <MoreHorizOutlinedIcon />
            </Badge>
          }
          onClick={openMore}
          aria-haspopup="true"
          sx={{ minHeight: 44 }}
        />
      </BottomNavigation>
      <Menu
        anchorEl={moreAnchor}
        open={moreOpen}
        onClose={closeMore}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <MenuItem component={RouterLink} to="/projects" onClick={closeMore}>
          <ListItemIcon>
            <ConstructionOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Projects
        </MenuItem>
        <MenuItem component={RouterLink} to="/locations" onClick={closeMore}>
          <ListItemIcon>
            <PlaceOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Locations
        </MenuItem>
        <MenuItem component={RouterLink} to="/verification" onClick={closeMore}>
          <ListItemIcon>
            <Badge badgeContent={overdueVerificationCount} color="error">
              <FactCheckOutlinedIcon fontSize="small" />
            </Badge>
          </ListItemIcon>
          Verification
        </MenuItem>
      </Menu>
    </Paper>
  );
}
