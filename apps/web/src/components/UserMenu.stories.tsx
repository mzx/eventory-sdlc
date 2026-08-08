import { AppBar, Toolbar, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import type { AuthUser } from '../api';
import { UserMenu } from './UserMenu';

const admin: AuthUser = {
  id: 'usr-demo-1',
  email: 'sam@workshop.dev',
  name: 'Sam Carter',
  picture: null,
  status: 'approved',
  role: 'admin',
  createdAt: '2026-08-01T10:00:00.000Z',
};

const meta = {
  title: 'Components/UserMenu',
  component: UserMenu,
  args: { user: admin },
  // In the app this lives at the right edge of the AppBar; reproduce that
  // context so the avatar renders on the primary-color bar.
  decorators: [
    (Story) => (
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Eventory
          </Typography>
          <Story />
        </Toolbar>
      </AppBar>
    ),
  ],
} satisfies Meta<typeof UserMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed state: initial avatar button on the AppBar. */
export const Closed: Story = {};

/** Menu open for an admin: name header, Admin › Users, log out. */
export const OpenAdmin: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByLabelText('account menu'));
  },
};

/** Menu open for a regular member — no admin entry. */
export const OpenMember: Story = {
  args: {
    user: {
      ...admin,
      id: 'usr-demo-2',
      email: 'alex@workshop.dev',
      name: 'Alex Kim',
      role: 'user',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByLabelText('account menu'));
  },
};
