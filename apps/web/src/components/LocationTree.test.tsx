import { ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LocationNode } from '../lib/locationTree';
import { theme } from '../theme';
import { LocationTree } from './LocationTree';

function node(
  id: string,
  name: string,
  itemCount: number,
  children: LocationNode[] = [],
  parentId: string | null = null,
): LocationNode {
  return { id, name, path: name, parentId, qrCode: `qr-${id}`, itemCount, children };
}

const nodes: LocationNode[] = [
  node('garage', 'Garage', 42, [node('workbench', 'Workbench', 12, [], 'garage')]),
  node('attic', 'Attic', 7),
];

function renderTree(props: Partial<Parameters<typeof LocationTree>[0]> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LocationTree
          nodes={nodes}
          onAddChild={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('LocationTree defaultExpanded', () => {
  it('renders collapsed by default — children hidden until the chevron is clicked', async () => {
    renderTree();
    expect(screen.queryByText('Workbench')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Expand Garage'));
    expect(screen.getByText('Workbench')).toBeInTheDocument();
  });

  it('renders children immediately when defaultExpanded is set', () => {
    renderTree({ defaultExpanded: true });
    expect(screen.getByText('Workbench')).toBeInTheDocument();
    // The row still shows the expanded-state toggle.
    expect(screen.getByLabelText('Collapse Garage')).toBeInTheDocument();
  });
});
