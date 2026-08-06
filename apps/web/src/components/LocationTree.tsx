import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  List,
  ListItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { LocationNode } from '../lib/locationTree';

interface LocationTreeProps {
  nodes: LocationNode[];
  onAddChild: (parentId: string | null, name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  depth?: number;
}

/** Recursive, collapsible location tree with inline add-child/rename/delete actions. */
export function LocationTree({
  nodes,
  onAddChild,
  onRename,
  onDelete,
  depth = 0,
}: LocationTreeProps) {
  return (
    <List dense disablePadding={depth > 0}>
      {nodes.map((node) => (
        <LocationTreeRow
          key={node.id}
          node={node}
          depth={depth}
          onAddChild={onAddChild}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </List>
  );
}

interface LocationTreeRowProps {
  node: LocationNode;
  depth: number;
  onAddChild: (parentId: string | null, name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function LocationTreeRow({ node, depth, onAddChild, onRename, onDelete }: LocationTreeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);

  const hasChildren = node.children.length > 0;

  function submitChild() {
    const trimmed = childName.trim();
    if (!trimmed) return;
    onAddChild(node.id, trimmed);
    setChildName('');
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

  return (
    <>
      <ListItem
        disableGutters
        sx={{ pl: depth * 3, py: 0.5 }}
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
            />
          ) : (
            <Typography
              component={RouterLink}
              to={`/locations/${node.id}`}
              variant="body2"
              sx={{ flexGrow: 1, color: 'text.primary', textDecoration: 'none' }}
            >
              {node.name}
            </Typography>
          )}

          <Chip
            label={node.itemCount}
            size="small"
            variant="outlined"
            aria-label={`${node.itemCount} items`}
          />

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
            <IconButton
              size="small"
              aria-label={`Rename ${node.name}`}
              onClick={() => {
                setRenameValue(node.name);
                setRenaming(true);
              }}
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={hasChildren ? 'Delete disabled — has child locations' : 'Delete'}>
            <span>
              <IconButton
                size="small"
                aria-label={`Delete ${node.name}`}
                disabled={hasChildren}
                onClick={() => {
                  if (window.confirm(`Delete "${node.name}"? This cannot be undone.`)) {
                    onDelete(node.id);
                  }
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </ListItem>

      {addingChild && (
        <ListItem disableGutters sx={{ pl: (depth + 1) * 3 + 4, py: 0.5 }}>
          <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
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
              fullWidth
            />
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
            />
          </Box>
        </Collapse>
      )}
    </>
  );
}
