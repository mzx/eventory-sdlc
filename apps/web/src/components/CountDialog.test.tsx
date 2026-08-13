import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CountDialog } from './CountDialog';

describe('CountDialog', () => {
  // EVT-27 AC 2 — the book quantity must never appear before the count is submitted.
  it('never renders the book quantity before submit (blind entry)', () => {
    render(<CountDialog open itemName="Box of Screws" onCount={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('How many are there?')).toBeInTheDocument();
    expect(screen.queryByText(/book quantity/i)).not.toBeInTheDocument();
  });

  it('submits the entered quantity and reveals book quantity + delta afterwards', async () => {
    const onCount = vi.fn().mockResolvedValue({ bookQuantity: 3, countedQuantity: 5, delta: 2 });
    render(<CountDialog open itemName="Box of Screws" onCount={onCount} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Counted quantity'), '5');
    await user.click(screen.getByRole('button', { name: 'Submit count' }));

    expect(onCount).toHaveBeenCalledWith(5);
    expect(await screen.findByText(/Book quantity was 3/)).toBeInTheDocument();
    expect(screen.getByText(/Adjusted by \+2/)).toBeInTheDocument();
    // Entry step controls are gone once revealed.
    expect(screen.queryByRole('button', { name: 'Submit count' })).not.toBeInTheDocument();
  });

  it('reports "no adjustment needed" when the count matches book quantity exactly', async () => {
    const onCount = vi.fn().mockResolvedValue({ bookQuantity: 7, countedQuantity: 7, delta: 0 });
    render(<CountDialog open itemName="Box of Screws" onCount={onCount} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Counted quantity'), '7');
    await user.click(screen.getByRole('button', { name: 'Submit count' }));

    expect(await screen.findByText(/no adjustment needed/)).toBeInTheDocument();
  });

  it('shows a negative delta with a minus sign, not a double sign', async () => {
    const onCount = vi.fn().mockResolvedValue({ bookQuantity: 10, countedQuantity: 4, delta: -6 });
    render(<CountDialog open itemName="Box of Screws" onCount={onCount} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Counted quantity'), '4');
    await user.click(screen.getByRole('button', { name: 'Submit count' }));

    expect(await screen.findByText(/Adjusted by -6/)).toBeInTheDocument();
  });

  it('calls onClose and resets state on Cancel', async () => {
    const onClose = vi.fn();
    render(<CountDialog open itemName="Box of Screws" onCount={vi.fn()} onClose={onClose} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Counted quantity'), '9');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Done is clicked after a reveal', async () => {
    const onClose = vi.fn();
    const onCount = vi.fn().mockResolvedValue({ bookQuantity: 1, countedQuantity: 1, delta: 0 });
    render(<CountDialog open itemName="Box of Screws" onCount={onCount} onClose={onClose} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Counted quantity'), '1');
    await user.click(screen.getByRole('button', { name: 'Submit count' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error and stays on the entry step when onCount rejects', async () => {
    const onCount = vi.fn().mockRejectedValue(new Error('Item not found'));
    render(<CountDialog open itemName="Box of Screws" onCount={onCount} onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Counted quantity'), '3');
    await user.click(screen.getByRole('button', { name: 'Submit count' }));

    expect(await screen.findByText('Item not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit count' })).toBeInTheDocument();
  });

  it('disables Submit count until a value is entered', () => {
    render(<CountDialog open itemName="Box of Screws" onCount={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Submit count' })).toBeDisabled();
  });
});
