import { app } from './app.js';

const port = process.env.PORT || 3001;
// Bind to localhost only -- nginx is the sole public entry point (see
// DEPLOYMENT.md). If this ever listened on all interfaces, a firewall
// misconfiguration would expose the API directly, bypassing nginx.
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`mechanic-movil-backend listening on ${host}:${port}`);
});
