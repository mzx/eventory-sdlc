import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { getPendingInviteToken } from '../workspace/useActiveWorkspace';
import { LoginPage } from './LoginPage';

function renderLogin(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage (EVT-43 AC4 sign-in-if-needed)', () => {
  afterEach(() => {
    // Mirrors test/setup.ts's afterEach cleanup, scoped to sessionStorage
    // (which that global hook doesn't touch) so a token stashed by one test
    // here can't leak into the next.
    sessionStorage.removeItem('eventory:pendingInviteToken');
  });

  it('plain sign-in visit leaves the Google URL unmodified', () => {
    renderLogin('/');

    const link = screen.getByRole('link', { name: /sign in with google/i });
    expect(link).toHaveAttribute('href', '/api/auth/google');
    expect(getPendingInviteToken()).toBeNull();
  });

  it('a visit to /invite/:token forwards the token as ?invite= and stashes it', () => {
    renderLogin('/invite/raw-token-abc');

    const link = screen.getByRole('link', { name: /sign in with google/i });
    expect(link).toHaveAttribute('href', '/api/auth/google?invite=raw-token-abc');
    expect(getPendingInviteToken()).toBe('raw-token-abc');
  });

  it('shows the stacked brand lockup as the page heading (brand/README.md)', () => {
    renderLogin('/');

    const logo = screen.getByRole('img', { name: 'Eventory' });
    expect(logo).toHaveAttribute('src', expect.stringContaining('eventory-logo-stacked'));
    expect(screen.getByRole('heading', { level: 1 })).toContainElement(logo);
  });
});
