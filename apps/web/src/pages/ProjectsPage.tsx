import AddIcon from '@mui/icons-material/Add';
import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject, fetchProjects, type ProjectListRow, type ProjectStatus } from '../api';

const STATUS_GROUPS: { status: ProjectStatus; label: string }[] = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'planned', label: 'Planned' },
  { status: 'completed', label: 'Completed' },
  { status: 'archived', label: 'Archived' },
];

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_OPTIONS: ProjectStatus[] = ['planned', 'in_progress', 'completed', 'archived'];

/** A single project card in the status-grouped list. */
function ProjectRow({ project }: { project: ProjectListRow }) {
  const navigate = useNavigate();
  return (
    <Card variant="outlined">
      <CardActionArea onClick={() => navigate(`/projects/${project.id}`)}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="subtitle1" component="h3">
                {project.name}
              </Typography>
              {project.description && (
                <Typography variant="body2" color="text.secondary">
                  {project.description}
                </Typography>
              )}
            </Box>
            <Chip
              size="small"
              label={`${project.lineCount} line${project.lineCount === 1 ? '' : 's'}`}
            />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/** Dialog to create a new project. */
function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('planned');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const createMutation = useMutation({
    mutationFn: () =>
      createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        status,
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setName('');
      setDescription('');
      setStatus('planned');
      onClose();
      navigate(`/projects/${project.id}`);
    },
  });

  const handleClose = () => {
    if (createMutation.isPending) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>New project</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            autoFocus
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            fullWidth
          >
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
          {createMutation.isError && (
            <Alert severity="error">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : 'Failed to create project'}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => createMutation.mutate()}
          disabled={!name.trim() || createMutation.isPending}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** `/projects` — status-grouped project list with a create-project dialog. */
export function ProjectsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects() });
  const projects = projectsQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" component="h1">
          Projects
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          New project
        </Button>
      </Stack>

      {projectsQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {projectsQuery.isError && (
        <Alert severity="error">
          {projectsQuery.error instanceof Error
            ? projectsQuery.error.message
            : 'Failed to load projects'}
        </Alert>
      )}

      {projectsQuery.isSuccess && projects.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <ConstructionOutlinedIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
          <Typography variant="h6" gutterBottom>
            No projects yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Start a project to track its bill of materials.
          </Typography>
        </Box>
      )}

      {STATUS_GROUPS.map(({ status, label }) => {
        const group = projects.filter((p) => p.status === status);
        if (group.length === 0) return null;
        return (
          <Box key={status}>
            <Typography variant="overline" color="text.secondary">
              {label}
            </Typography>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {group.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </Stack>
          </Box>
        );
      })}

      <CreateProjectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
}
