import { configureTrustProxy } from './trust-proxy.config';

// ---------------------------------------------------------------------------
// EVT-19 review round 2, finding 2 — unit coverage for enabling Express
// `trust proxy` behind the Caddy reverse proxy. Without this, every
// request's `req.ip` resolves to Caddy's container IP, collapsing
// @nestjs/throttler's per-IP buckets into one shared bucket for all
// callers.
// ---------------------------------------------------------------------------

describe('configureTrustProxy', () => {
  it('sets trust proxy to 1 (trust exactly one hop: Caddy)', () => {
    const app = { set: jest.fn() };

    configureTrustProxy(app);

    expect(app.set).toHaveBeenCalledWith('trust proxy', 1);
    expect(app.set).toHaveBeenCalledTimes(1);
  });
});
