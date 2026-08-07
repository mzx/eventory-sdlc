// This file intentionally colocates the context object, the `useAuth` hook,
// and the `AuthProvider` component — splitting them into separate files
// purely to satisfy Fast Refresh boundaries would scatter three tightly
// coupled pieces across three files for a dev-only hot-reload nicety, not a
// correctness concern.
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchCurrentUser, setAuthFailureListener, type AuthUser } from '../api';

export interface AuthContextValue {
  /** `null` when signed out (or not yet loaded — check `loading` first). */
  user: AuthUser | null;
  /** `true` only for the initial `GET /api/auth/me` at boot. */
  loading: boolean;
  /** Re-fetches `/api/auth/me`. Used by PendingPage's "check again" and
   * whenever any API call comes back 401/403 (session expired/rejected). */
  refresh: () => Promise<void>;
}

// Exported (not just `AuthProvider`/`useAuth`) so page-level tests can wrap
// components in a fixture value without going through a real `fetchCurrentUser`
// round-trip — see AdminUsersPage.test.tsx.
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Loads `GET /api/auth/me` once at boot and exposes `{ user, loading,
 * refresh }` to the whole app. Also wires itself up as `api.ts`'s
 * auth-failure listener so a 401/403 from ANY endpoint (e.g. an admin
 * rejects the user mid-session) re-checks auth state — AC4 / non-401-flash
 * requirement in EVT-15.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const current = await fetchCurrentUser();
      setUser(current);
    } catch {
      // A failed /auth/me fetch (network error) is treated as signed-out —
      // AuthGate will show LoginPage rather than get stuck loading forever.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setAuthFailureListener(() => {
      void refresh();
    });
    return () => setAuthFailureListener(null);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, refresh }),
    [user, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
