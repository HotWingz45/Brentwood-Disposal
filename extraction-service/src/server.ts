import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import extractRouter  from './routes/extract';
import healthRouter        from './routes/health';
import healthDetailsRouter from './routes/healthDetails';
import versionRouter  from './routes/version';
import { logger } from './logger';

const app  = express();
const MAX_PAYLOAD_BYTES = parseInt(process.env['MAX_PAYLOAD_BYTES'] ?? '26214400', 10);

// ── CORS ──────────────────────────────────────────────────────────
const rawOrigins = process.env['ALLOWED_ORIGINS'] ?? '';
const allowedOrigins = rawOrigins ? rawOrigins.split(',').map((s) => s.trim()) : [];

app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, cb) => {
        // Allow requests with no origin (mobile apps, curl)
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} not allowed by CORS`));
      }
    : true, // allow all when ALLOWED_ORIGINS is not set
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// ── Security headers ──────────────────────────────────────────────
app.use(helmet());

// ── Body parsing ──────────────────────────────────────────────────
// Raw JSON payload up to MAX_PAYLOAD_BYTES (base64-encoded file content)
app.use(express.json({ limit: MAX_PAYLOAD_BYTES }));

// ── Routes ────────────────────────────────────────────────────────
app.use('/extract', extractRouter);
app.use('/health',         healthRouter);
app.use('/health/details', healthDetailsRouter);
app.use('/version', versionRouter);

// Root redirect → health
app.get('/', (_req, res) => res.redirect('/health'));

// ── 404 ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
});

// ── Unhandled error handler ───────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('SERVER', `Unhandled error: ${err.message}`);
  res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

export default app;
