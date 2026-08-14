import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { LocationKind } from '../api';
import type { LocationNode } from '../lib/locationTree';
import { frostedPanel } from '../theme';

/**
 * Visual indent per tree depth. Below `sm`, capped at 3 levels — at the
 * original unbounded `depth * 3` a name at depth 2 had <100px left and
 * depth 3+ had ~nothing on a 390px screen (2026-08-14 mobile audit finding
 * #7). Deeper nodes still render at their real depth; they just stop
 * pushing further right once the indent itself would crush the name
 * column. AC-3 requires desktop unchanged, so `sm` and up keep the
 * original unbounded `depth * 3` formula — only `xs` gets the cap.
 * `extra` is an optional flat offset (in the same `spacing` units) applied
 * at both breakpoints, e.g. for the inline add-child row's indent.
 */
function indentPl(depth: number, extra = 0): { xs: number; sm: number } {
  return { xs: Math.min(depth, 3) * 1.5 + extra, sm: depth * 3 + extra };
}

/**
 * Distinct icon per `Location.kind` (EVT-30 AC 5) — a fixed `area` reads as
 * a folder; a movable `container` reads as a box. Missing `kind` (older
 * fixtures/tests predating EVT-30) falls back to the `area` folder icon.
 */
function KindIcon({ kind }: { kind?: LocationKind }) {
  return kind === 'container' ? (
    <Inventory2OutlinedIcon fontSize="small" color="action" aria-label="Container" />
  ) : (
    <FolderOutlinedIcon fontSize="small" color="action" aria-label="Area" />
  );
}

interface LocationTreeProps {
  nodes: LocationNode[];
  onAddChild: (parentId: string | null, name: string, kind: LocationKind) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  depth?: number;
  /** Render every row with children initially expanded (deep links, previews). */
  defaultExpanded?: boolean;
}

/** Recursive, collapsible location tree with inline add-child/rename/delete actions. */
export function LocationTree({
  nodes,
  onAddChild,
  onRename,
  onDelete,
  depth = 0,
  defaultExpanded = false,
}: LocationTreeProps) {
  const list = (
    <List dense disablePadding={depth > 0}>
      {nodes.map((node) => (
        <LocationTreeRow
          key={node.id}
          node={node}
          depth={depth}
          onAddChild={onAddChild}
          onRename={onRename}
          onDelete={onDelete}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </List>
  );

  // Root level only: the tree sits on a frosted drawing panel so the grid
  // blurs behind row text; nested levels render inside the same panel.
  if (depth > 0) {
    return list;
  }
  return <Box sx={{ ...frostedPanel, px: 1.5, py: 0.5 }}>{list}</Box>;
}

interface LocationTreeRowProps {
  node: LocationNode;
  depth: number;
  onAddChild: (parentId: string | null, name: string, kind: LocationKind) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  defaultExpanded: boolean;
}

function LocationTreeRow({
  node,
  depth,
  onAddChild,
  onRename,
  onDelete,
  defaultExpanded,
}: LocationTreeRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState('');
  const [childKind, setChildKind] = useState<LocationKind>('area');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  // Overflow menu (xs only — see the `display` sx below): rename/add-child/
  // delete move behind one `MoreVertIcon` button once there's no room for
  // three separate icon buttons alongside the name (2026-08-14 mobile audit
  // finding #7). Desktop keeps the inline icon-button row unchanged.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // Deferred-rename timer (see the overflow menu's "Rename" onClick below) —
  // cleared on unmount so a row removed (e.g. via delete elsewhere in the
  // tree causing a re-render) between the menu closing and the timeout
  // firing can't re-enter rename mode on a component that's gone.
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (renameTimerRef.current !== null) clearTimeout(renameTimerRef.current);
    };
  }, []);

  const hasChildren = node.children.length > 0;

  function submitChild() {
    const trimmed = childName.trim();
    if (!trimmed) return;
    onAddChild(node.id, trimmed, childKind);
    setChildName('');
    setChildKind('area');
    setAddingChild(false);
    setExpanded(true);
  }

  function submitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === node.name) {
      setRenaming(false);
      return;
    }
    onRename(node.id, trimmed);
    setRenaming(false);
  }

  function startRename() {
    setRenameValue(node.name);
    setRenaming(true);
  }

  function confirmDelete() {
    if (window.confirm(`Delete "${node.name}"? This cannot be undone.`)) {
      onDelete(node.id);
    }
  }

  return (
    <>
      <ListItem
        disableGutters
        sx={{ pl: indentPl(depth), py: 0.5 }}
        data-testid={`location-node-${node.id}`}
      >
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: '100%' }}>
          <IconButton
            size="small"
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => setExpanded((e) => !e)}
            disabled={!hasChildren}
            sx={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>

          <KindIcon kind={node.kind} />

          {renaming ? (
            <TextField
              size="small"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              onBlur={submitRename}
              inputProps={{ 'aria-label': `Rename ${node.name}` }}
              sx={{ minWidth: 0, flexGrow: 1 }}
            />
          ) : (
            <Typography
              component={RouterLink}
              to={`/locations/${node.id}`}
              variant="body2"
              noWrap
              sx={{ flexGrow: 1, minWidth: 0, color: 'text.primary', textDecoration: 'none' }}
            >
              {node.name}
            </Typography>
          )}

          <Chip
            label={node.itemCount}
            size="small"
            variant="outlined"
            aria-label={`${node.itemCount} items`}
            sx={{ flexShrink: 0 }}
          />

          {/* Desktop (>= sm): the three actions stay inline, unchanged. */}
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}
          >
            <Tooltip title="Add child location">
              <IconButton
                size="small"
                aria-label={`Add child to ${node.name}`}
                onClick={() => setAddingChild((v) => !v)}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Rename">
              <IconButton size="small" aria-label={`Rename ${node.name}`} onClick={startRename}>
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={hasChildren ? 'Delete disabled — has child locations' : 'Delete'}>
              <span>
                <IconButton
                  size="small"
                  aria-label={`Delete ${node.name}`}
                  disabled={hasChildren}
                  onClick={confirmDelete}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          {/* xs: one overflow button + menu instead of three icon buttons —
              at depth >= 2 there isn't 190-210px to spare alongside a
              readable name on a 390px screen. */}
          <Tooltip title="More actions">
            <IconButton
              size="small"
              aria-label={`More actions for ${node.name}`}
              onClick={(e: MouseEvent<HTMLElement>) => setMenuAnchor(e.currentTarget)}
              sx={{ display: { xs: 'inline-flex', sm: 'none' }, flexShrink: 0 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                setAddingChild((v) => !v);
              }}
            >
              <ListItemIcon>
                <AddIcon fontSize="small" />
              </ListItemIcon>
              Add child
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                // Deferred: MUI's Menu restores focus to the anchor
                // (`More actions`) as it closes. Calling `startRename`
                // synchronously here races that restoration — the freshly
                // mounted, `autoFocus`ed rename `TextField` can lose focus
                // again immediately, firing its `onBlur` no-op-submit and
                // snapping straight back out of rename mode. Letting the
                // Menu's close/focus-restore finish first avoids it.
                renameTimerRef.current = setTimeout(startRename, 0);
              }}
            >
              <ListItemIcon>
                <EditOutlinedIcon fontSize="small" />
              </ListItemIcon>
              Rename
            </MenuItem>
            <MenuItem
              disabled={hasChildren}
              onClick={() => {
                setMenuAnchor(null);
                confirmDelete();
              }}
            >
              <ListItemIcon>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              {hasChildren ? 'Delete (has child locations)' : 'Delete'}
            </MenuItem>
          </Menu>
        </Stack>
      </ListItem>

      {addingChild && (
        <ListItem disableGutters sx={{ pl: indentPl(depth + 1, 4), py: 0.5 }}>
          {/* Wraps below `sm` — the name field plus the two-option toggle
              group plus the confirm button are similarly over-wide at 390px
              (2026-08-14 mobile audit finding #7); the name field takes its
              own row first, toggle + confirm share the next. */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ width: '100%', flexWrap: 'wrap' }}
            alignItems="center"
          >
            <TextField
              size="small"
              autoFocus
              placeholder="New location name"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitChild();
                if (e.key === 'Escape') setAddingChild(false);
              }}
              inputProps={{ 'aria-label': `New child location name for ${node.name}` }}
              sx={{ flexGrow: 1, minWidth: { xs: '100%', sm: 0 } }}
            />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={childKind}
              onChange={(_e, value: LocationKind | null) => value && setChildKind(value)}
              aria-label={`New child kind for ${node.name}`}
            >
              <ToggleButton value="area" aria-label="Area">
                <Tooltip title="Area (fixed shelf/room)">
                  <FolderOutlinedIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="container" aria-label="Container">
                <Tooltip title="Container (movable box)">
                  <Inventory2OutlinedIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
            <IconButton size="small" aria-label="Confirm add child" onClick={submitChild}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Stack>
        </ListItem>
      )}

      {hasChildren && (
        <Collapse in={expanded} unmountOnExit>
          <Box>
            <LocationTree
              nodes={node.children}
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
            />
          </Box>
        </Collapse>
      )}
    </>
  );
}
