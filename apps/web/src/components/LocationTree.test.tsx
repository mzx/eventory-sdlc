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

// EVT-37 finding #7: rows at depth >= 2 (5 fixed-width controls + unbounded
// `pl: depth * 3` indentation) left <100px for the name at 390px. The cap
// stops the indent growing past depth 3 so the name column stays usable.
describe('LocationTree indent cap (EVT-37 AC 3)', () => {
  it('caps left padding at depth 3 instead of growing indent unbounded per depth', () => {
    const deepChain: LocationNode = node('d0', 'D0', 1, [
      node('d1', 'D1', 1, [
        node('d2', 'D2', 1, [node('d3', 'D3', 1, [node('d4', 'D4', 1)], 'd2')], 'd1'),
      ]),
    ]);
    renderTree({ nodes: [deepChain], defaultExpanded: true });

    expect(screen.getByTestId('location-node-d0')).toHaveStyle({ paddingLeft: '0px' });
    expect(screen.getByTestId('location-node-d1')).toHaveStyle({ paddingLeft: '12px' });
    expect(screen.getByTestId('location-node-d2')).toHaveStyle({ paddingLeft: '24px' });
    // Depth 3 and depth 4 both cap at the same indent (Math.min(depth, 3)).
    expect(screen.getByTestId('location-node-d3')).toHaveStyle({ paddingLeft: '36px' });
    expect(screen.getByTestId('location-node-d4')).toHaveStyle({ paddingLeft: '36px' });
  });

  it('truncates a long name with an ellipsis instead of wrapping/pushing controls off-row', () => {
    const longName = 'A'.repeat(80);
    renderTree({ nodes: [node('long', longName, 3)] });

    expect(screen.getByText(longName)).toHaveClass('MuiTypography-noWrap');
  });
});

// EVT-37 finding #7: at xs, rename/add-child/delete move behind one overflow
// `MoreVertIcon` button + menu instead of three separate icon buttons, so
// there's room for a readable name at depth >= 2 on a 390px screen. The
// menu items must fire the identical callbacks as the desktop inline icons.
describe('LocationTree overflow menu (EVT-37 AC 3)', () => {
  it('renames a node via the overflow menu', async () => {
    const onRename = vi.fn();
    renderTree({ onRename });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Garage' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'Rename Garage' });
    await user.clear(input);
    await user.type(input, 'Workshop{Enter}');

    expect(onRename).toHaveBeenCalledWith('garage', 'Workshop');
  });

  it('adds a child via the overflow menu', async () => {
    const onAddChild = vi.fn();
    renderTree({ onAddChild });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Garage' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add child' }));
    await user.type(screen.getByLabelText('New child location name for Garage'), 'Shelf C{Enter}');

    expect(onAddChild).toHaveBeenCalledWith('garage', 'Shelf C', 'area');
  });

  it('deletes a leaf node via the overflow menu after confirming', async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTree({ onDelete, nodes: [node('attic', 'Attic', 7)] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Attic' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "Attic"? This cannot be undone.');
    expect(onDelete).toHaveBeenCalledWith('attic');
  });

  it('disables the overflow menu Delete item for a node with children', async () => {
    renderTree();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Garage' }));

    expect(screen.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
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
