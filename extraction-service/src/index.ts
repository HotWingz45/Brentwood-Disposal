import 'dotenv/config';
import app from './server';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── Process-level error capture ───────────────────────────────────
// These must be registered BEFORE the server starts so any crash
// during module initialization or request handling appears in logs.

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message);
  console.error(err.stack ?? '');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  process.exit(1);
});

// ── Start server ──────────────────────────────────────────────────
// Always bind to 0.0.0.0 so Railway's load balancer can reach us.
// Never read HOST from env — some environments inject localhost which
// would silently accept the bind but block all external traffic.

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[START] listening on 0.0.0.0:${PORT} (NODE_ENV=${process.env.NODE_ENV ?? 'development'})`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[FATAL] listen error: ${err.code} ${err.message}`);
  process.exit(1);
});
