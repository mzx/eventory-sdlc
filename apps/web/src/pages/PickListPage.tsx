import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  fetchProjectAvailability,
  updateBomLine,
  type AvailabilityLine,
  type ProjectAvailability,
} from '../api';

interface LocationGroup {
  /** Sort key — `''` for lines whose item has no location set, sorts first. */
  path: string;
  label: string;
  lines: AvailabilityLine[];
}

/**
 * Groups item-linked BOM lines by their linked item's storage location,
 * ordered by location path so the list reads as a walkable route through the
 * storage tree (AC 3) — the same materialized-path ordering `LocationsService`
 * uses for the flat locations list.
 *
 * Free-text (untracked) lines are excluded — they're not sourced from
 * inventory, so there's nowhere to walk to pick them (EVT-29 pick-list
 * non-goal: only item-linked lines appear here; see `ProjectDetailPage`'s
 * availability panel for untracked-line visibility instead).
 */
function groupByLocation(lines: AvailabilityLine[]): LocationGroup[] {
  const itemLinked = lines.filter((line) => line.itemId !== null);
  const groups = new Map<string, LocationGroup>();

  for (const line of itemLinked) {
    const path = line.location?.path ?? '';
    if (!groups.has(path)) {
      groups.set(path, {
        path,
        label: line.location ? `${line.location.name} (${line.location.path})` : 'No location set',
        lines: [],
      });
    }
    groups.get(path)?.lines.push(line);
  }

  return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * `/projects/:id/pick-list` — a walkable, check-off-able pick list for a
 * project's item-linked BOM lines, grouped and ordered by storage location
 * (AC 3), with a print stylesheet (AC 5) so it can go to the workbench on
 * paper. Rendered OUTSIDE `AppShell` (no AppBar) for the same reason
 * `ItemPrintPage` is — printing must not include app nav chrome.
 *
 * Check-off state (`BomLine.picked`) persists via `PATCH .../bom/:lineId`
 * and survives reloads (AC 3) — it is informational only, not a stock
 * reservation (EVT-29 non-goal).
 */
export function PickListPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const availabilityQuery = useQuery({
    queryKey: ['projects', id, 'availability'],
    queryFn: () => fetchProjectAvailability(id as string),
    enabled: Boolean(id),
  });

  const pickMutation = useMutation({
    mutationFn: ({ lineId, picked }: { lineId: string; picked: boolean }) =>
      updateBomLine(id as string, lineId, { picked }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', id, 'availability'] }),
  });

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720, mx: 'auto' }}>
      <style>{'@media print { .no-print { display: none !important; } }'}</style>

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        className="no-print"
        sx={{ mb: 2 }}
      >
        <Button component={RouterLink} to={`/projects/${id}`}>
          ← Back to project
        </Button>
        <Button variant="contained" onClick={() => window.print()} data-testid="trigger-print">
          Print
        </Button>
      </Stack>

      <Typography variant="h5" component="h1" gutterBottom>
        Pick list
      </Typography>

      {availabilityQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }} className="no-print">
          <CircularProgress />
        </Box>
      )}

      {availabilityQuery.isError && (
        <Alert severity="error" className="no-print">
          {availabilityQuery.error instanceof Error
            ? availabilityQuery.error.message
            : 'Failed to load the pick list'}
        </Alert>
      )}

      {availabilityQuery.data && (
        <PickListBody availability={availabilityQuery.data} onPick={pickMutation.mutate} />
      )}
    </Box>
  );
}

function PickListBody({
  availability,
  onPick,
}: {
  availability: ProjectAvailability;
  onPick: (input: { lineId: string; picked: boolean }) => void;
}) {
  const groups = groupByLocation(availability.lines);
  const total = groups.reduce((sum, g) => sum + g.lines.length, 0);
  const pickedCount = groups.reduce(
    (sum, g) => sum + g.lines.filter((line) => line.picked).length,
    0,
  );

  return (
    <>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {pickedCount} of {total} picked
      </Typography>
      <LinearProgress
        className="no-print"
        variant="determinate"
        value={total === 0 ? 0 : (pickedCount / total) * 100}
        sx={{ mb: 3, height: 8, borderRadius: 4 }}
      />

      {total === 0 && (
        <Typography variant="body2" color="text.secondary">
          No item-linked BOM lines to pick — add one from the project page.
        </Typography>
      )}

      {groups.map((group) => (
        <Box key={group.path || 'unlocated'} sx={{ mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
            {group.label}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Part</TableCell>
                <TableCell align="right">Qty</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {group.lines.map((line) => (
                <TableRow key={line.lineId}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={line.picked}
                      onChange={(e) => onPick({ lineId: line.lineId, picked: e.target.checked })}
                      inputProps={{ 'aria-label': `Picked ${line.name}` }}
                      sx={{ '& .MuiSvgIcon-root': { fontSize: 28 } }}
                    />
                  </TableCell>
                  <TableCell>{line.name}</TableCell>
                  <TableCell align="right">
                    {line.quantity} {line.unit ?? ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ))}
    </>
  );
}
