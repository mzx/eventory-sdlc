import { Box } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { LocationNode } from '../lib/locationTree';
import { LocationTree } from './LocationTree';

function node(
  id: string,
  name: string,
  path: string,
  itemCount: number,
  children: LocationNode[] = [],
  parentId: string | null = null,
): LocationNode {
  return { id, name, path, parentId, qrCode: `qr-${id}`, itemCount, children };
}

const nodes: LocationNode[] = [
  node('garage', 'Garage', 'Garage', 42, [
    node('workbench', 'Workbench', 'Garage.Workbench', 12, [], 'garage'),
    node(
      'shelf-a',
      'Shelf A',
      'Garage.Shelf A',
      18,
      [
        node('bin-1', 'Bin 1', 'Garage.Shelf A.Bin 1', 6, [], 'shelf-a'),
        node('bin-2', 'Bin 2', 'Garage.Shelf A.Bin 2', 9, [], 'shelf-a'),
      ],
      'garage',
    ),
  ]),
  node('attic', 'Attic', 'Attic', 7),
];

const meta = {
  title: 'Components/LocationTree',
  component: LocationTree,
  args: {
    nodes,
    onAddChild: fn(),
    onRename: fn(),
    onDelete: fn(),
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 420 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof LocationTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Roots collapsed — chevrons only on rows that have children. */
export const Collapsed: Story = {};

/** Full hierarchy visible via `defaultExpanded` (deep-link / preview state). */
export const Expanded: Story = {
  args: { defaultExpanded: true },
};
