import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ProjectsPage } from './ProjectsPage';

function projectRow(overrides: Partial<api.ProjectListRow> = {}): api.ProjectListRow {
  return {
    id: 'project-1',
    name: 'Garage workbench',
    description: null,
    status: 'planned',
    notes: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lineCount: 0,
    ...overrides,
  };
}

function renderProjectsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<div>Project detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups projects by status', async () => {
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([
      projectRow({ id: 'p1', name: 'Workbench', status: 'in_progress' }),
      projectRow({ id: 'p2', name: 'Shelving unit', status: 'planned' }),
    ]);

    renderProjectsPage();

    expect(await screen.findByText('Workbench')).toBeInTheDocument();
    expect(screen.getByText('Shelving unit')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
  });

  it('shows an empty state when there are no projects', async () => {
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([]);

    renderProjectsPage();

    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
  });

  it('creates a project via the dialog and navigates to its detail page', async () => {
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([]);
    const createProjectMock = vi.spyOn(api, 'createProject').mockResolvedValue({
      id: 'new-project',
      name: 'New build',
      description: null,
      status: 'planned',
      notes: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      bomLines: [],
      consumed: [],
    });

    const user = userEvent.setup();
    renderProjectsPage();

    await screen.findByText('No projects yet');

    await user.click(screen.getByRole('button', { name: /new project/i }));
    // The `required` field's label renders as "Name *" (asterisk appended),
    // so match by prefix rather than exact text.
    await user.type(screen.getByLabelText(/^Name/), 'New build');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New build', status: 'planned' }),
      ),
    );
    expect(await screen.findByText('Project detail page')).toBeInTheDocument();
  });
});
