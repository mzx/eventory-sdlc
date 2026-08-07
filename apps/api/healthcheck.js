// Docker HEALTHCHECK probe (see the `api` service in docker-compose.yml).
//
// The API serves HTTPS when mkcert certs are present under
// apps/api/certs/ (bind-mounted from the host — see common/https-options.ts
// / EVT-18) and plain HTTP otherwise. Rather than duplicate that
// cert-presence check here, this just tries https first and falls back to
// http on any connection error, so the healthcheck works in both modes.
const https = require('node:https');
const http = require('node:http');

function exit(ok) {
  process.exit(ok ? 0 : 1);
}

function probeHttp() {
  http
    .get('http://localhost:3001/api/health', (res) => exit(res.statusCode === 200))
    .on('error', () => exit(false));
}

https
  // rejectUnauthorized: false — loopback-only rationale: this probe always
  // hits a hardcoded https://localhost inside the container, and mkcert
  // certs can't be chain-validated there (the mkcert root CA isn't in
  // Node's trust store inside the image). Safe ONLY because the target is
  // hardcoded to localhost and never operator/network-supplied — do NOT
  // copy this pattern into any app HTTP client that calls a remote host.
  .get('https://localhost:3001/api/health', { rejectUnauthorized: false }, (res) =>
    exit(res.statusCode === 200),
  )
  .on('error', probeHttp);
