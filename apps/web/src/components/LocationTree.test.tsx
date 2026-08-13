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
  kind: LocationNode['kind'] = 'area',
): LocationNode {
  return { id, name, path: name, parentId, qrCode: `qr-${id}`, kind, itemCount, children };
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

// EVT-30 AC 5: containers render with a distinct icon from areas.
describe('LocationTree kind icon', () => {
  it('renders the Area icon for an area node and the Container icon for a container node', () => {
    const mixedNodes: LocationNode[] = [
      node('garage', 'Garage', 1, [], null, 'area'),
      node('bin-1', 'Bin 1', 2, [], null, 'container'),
    ];
    renderTree({ nodes: mixedNodes });

    const garageRow = screen.getByTestId('location-node-garage');
    const binRow = screen.getByTestId('location-node-bin-1');

    expect(garageRow.querySelector('[aria-label="Area"]')).not.toBeNull();
    expect(binRow.querySelector('[aria-label="Container"]')).not.toBeNull();
  });

  it('falls back to the Area icon when kind is missing (fixtures predating EVT-30)', () => {
    const legacyNode: LocationNode = { ...node('legacy', 'Legacy', 0), kind: undefined };
    renderTree({ nodes: [legacyNode] });

    expect(
      screen.getByTestId('location-node-legacy').querySelector('[aria-label="Area"]'),
    ).not.toBeNull();
  });
});

// EVT-30 AC 1: containers creatable inline from the tree.
describe('LocationTree add-child kind toggle', () => {
  it('defaults to "area" and creates an area when the toggle is left untouched', async () => {
    const onAddChild = vi.fn();
    renderTree({ onAddChild });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add child to Garage' }));
    await user.type(screen.getByLabelText('New child location name for Garage'), 'Shelf B{Enter}');

    expect(onAddChild).toHaveBeenCalledWith('garage', 'Shelf B', 'area');
  });

  it('creates a container when the Container toggle is selected before confirming', async () => {
    const onAddChild = vi.fn();
    renderTree({ onAddChild });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add child to Garage' }));
    await user.click(screen.getByRole('button', { name: 'Container' }));
    await user.type(screen.getByLabelText('New child location name for Garage'), 'Tote Box{Enter}');

    expect(onAddChild).toHaveBeenCalledWith('garage', 'Tote Box', 'container');
  });
});
